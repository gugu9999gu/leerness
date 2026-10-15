'use strict';
require('./temp-cleanup').trackTemp(module); // T-0357: records this run's temp folders; the runner that started it removes them after a clean exit
const assert = require('assert'), fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process');
const { createHash } = require('crypto');
const { removeTree } = require('./temp-cleanup');
if (!process.argv.includes('--worker')) {
  const arena = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-audit-text-'));
  try {
    const env = { ...process.env, AUDIT_TEXT_ROOT: arena };
    for (const key of ['HOME', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA', 'TEMP', 'TMP']) { env[key] = path.join(arena, key.toLowerCase());fs.mkdirSync(env[key]); }
    const r = cp.spawnSync(process.execPath, [__filename, '--worker', ...process.argv.slice(2)], { encoding: 'utf8', timeout: 600000, windowsHide: true, env });
    process.stdout.write(r.stdout || '');process.stderr.write(r.stderr || '');if (r.error) process.stderr.write(r.error.message + '\n');
    process.exitCode = r.status === 0 && !r.error ? 0 : 1;
  } finally {
    const resolved = fs.realpathSync(arena);assert.strictEqual(path.dirname(resolved).toLowerCase(), fs.realpathSync(os.tmpdir()).toLowerCase());
    assert.ok(path.basename(resolved).startsWith('leerness-audit-text-'));removeTree(resolved, { recursive: true, force: true });
  }
  return;
}
const arena = process.env.AUDIT_TEXT_ROOT, cli = path.resolve(__dirname, '../bin/leerness.js');
const sample = '한글 English 日本語 中文 e\u0301 🐝 \uFFFD';
const body = {
  handoff: '# Session handoff\r\nLast generated: (auto)\r\n\r\n## Custom notes\r\nKeep ' + sample + '\r\nLast generated: (자동)\r\n',
  state: '# Current state\r\nUpdated: 2000-01-01\r\n\r\n## Custom notes\r\nKeep ' + sample + '\r\nUpdated: 1999-12-31\r\n'
};
const today = () => new Date().toISOString().slice(0, 10);
function fixedBody(key, value = body[key]) { return key === 'handoff' ? value.replace(/Last generated: \((auto|자동)\)/, 'Last generated: ' + today() + ' (leerness audit --fix)') : value.replace(/Updated: \d{4}-\d{2}-\d{2}/, 'Updated: ' + today()); }
let sequence = 0, passed = 0, failed = 0;
const at = process.argv.indexOf('--match'), filter = at < 0 ? '' : process.argv[at + 1];
function test(name, fn) { if (filter && !name.includes(filter)) return;try { fn();passed++;console.log('PASS ' + name); } catch (e) { failed++;console.error('FAIL ' + name + ': ' + e.stack); } }
const core = require('../bin/leerness');
function fixture(key = 'state') {
  const dir = path.join(arena, (++sequence) + '-한글 project'), ws = path.join(dir, '.leerness');fs.mkdirSync(ws, { recursive: true });
  for (const [name, value] of Object.entries(core.coreFiles(dir, 'en'))) {
    const file = path.join(dir, name);fs.mkdirSync(path.dirname(file), { recursive: true });fs.writeFileSync(file, value);
  }
  const f = { dir, ws, handoff: path.join(ws, 'session-handoff.md'), state: path.join(ws, 'current-state.md'), key };
  fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"audit-text-test","version":"1.0.0"}\n');
  fs.writeFileSync(path.join(dir, '.gitignore'), '.env\n.env.*\n');
  fs.writeFileSync(f.handoff, '# Session handoff\nLast generated: 2026-01-01\n\n## Notes\n' + sample + '\n');
  fs.writeFileSync(f.state, '# Current state\nUpdated: ' + today() + '\n\n## Notes\n' + sample + '\n');
  fs.writeFileSync(f[key], body[key]);return f;
}
const text = p => fs.readFileSync(p, 'utf8');
function snapshot(file) { if (!fs.existsSync(file)) return null;const s = fs.statSync(file, { bigint: true });return { sha: createHash('sha256').update(fs.readFileSync(file)).digest('hex'), mtime: String(s.mtimeNs) }; }
const hook = path.join(arena, 'boundary-hook.cjs');
fs.writeFileSync(hook, String.raw`
const fs=require('fs'),path=require('path'),cp=require('child_process'),base=process.env.AUDIT_TEXT_LIB,target=process.env.AUDIT_TEXT_TARGET,mode=process.env.AUDIT_TEXT_MODE;
const write=fs.writeFileSync.bind(fs),bytes=Buffer.from(process.env.AUDIT_TEXT_WINNER,'base64');let fired=false;
const locks=require(path.join(base,'state-lock')),io=require(path.join(base,'io')),read=io.read,exists=io.exists;
const inject=p=>{if(!fired&&p===target){fired=true;if(mode==='remove-before'||mode==='remove-after')fs.unlinkSync(p);else {write(p,bytes);fs.utimesSync(p,1000000000,1000000000);}}};
io.exists=function(p){if(mode==='remove-before'&&locks.isStateLockHeld(p))inject(p);return exists(p);};
io.read=function(p){if(mode==='before-capture'&&locks.isStateLockHeld(p))inject(p);const result=read(p);if(mode==='after-capture'&&locks.isStateLockHeld(p))inject(p);return result;};
const mod=require(path.join(base,'managed-text')),capture=mod.captureTextEdit,publish=mod.publishTextEdit;
mod.captureTextEdit=function(p,...a){
  if(p===target&&mode==='lock-check'&&!locks.isStateLockHeld(p))throw Error('missing canonical lock');
  if(mode==='before-capture'||mode==='remove-before')inject(p);const result=capture(p,...a);
  if(mode==='after-capture'||mode==='remove-after')inject(p);return result;
};
mod.publishTextEdit=function(s,p,t){
  if(mode==='write-failure'&&p===target)throw Error('injected publication failure');const r=publish(s,p,t);
  if(mode==='late-failure'&&p===target)throw Error('injected failure after publication');return r;
};
const rename=fs.renameSync.bind(fs);fs.renameSync=function(a,b){if(mode==='publication'&&a===target)inject(a);return rename(a,b);};
const spawn=cp.spawnSync.bind(cp);cp.spawnSync=function(a,b,o){if(o?.env?.LEERNESS_REPLACE_TO===target){if(mode==='publication')inject(target);const r=spawn(a,b,o);if(mode==='after-publication'&&r.status===0)inject(target);return r;}return spawn(a,b,o);};
const link=fs.linkSync.bind(fs);fs.linkSync=function(a,b){if(mode==='publication')inject(b);const r=link(a,b);if(mode==='after-publication')inject(b);return r;};
`);
const direct = path.join(arena, 'direct-library.cjs');
fs.writeFileSync(direct, String.raw`
const path=require('path'),base=process.env.AUDIT_TEXT_LIB,ws=(r,n)=>path.join(r,'.leerness',n);
require(path.join(base,'audit')).audit(process.argv[3],{json:true},{
  VERSION:require(path.join(base,'../package.json')).version,has:f=>process.argv.includes(f),arg:(k,d)=>d,
  planPath:r=>ws(r,'plan.md'),handoffPath:r=>ws(r,'session-handoff.md'),currentStatePath:r=>ws(r,'current-state.md'),
  readProgressRows:()=>[],envDiff:()=>({envPath:'',examplePath:''}),_readFeatureGraph:()=>({nodes:[]}),_listAPISkills:()=>[]
});
`);
function call(f, opts = {}) {
  const r = cp.spawnSync(process.execPath, [...(opts.mode ? ['--require', hook] : []), opts.direct ? direct : cli, 'audit', f.dir, ...(opts.args || ['--fix']), ...(opts.human ? [] : ['--json'])], {
    cwd: f.dir, encoding: 'utf8', timeout: 45000, windowsHide: true,
    env: { ...process.env, LEERNESS_INTERNAL: '1', LEERNESS_HOOK: '', LEERNESS_OFFLINE: '1', LEERNESS_NO_AUTOCHCP: '1', LEERNESS_NO_STALE_CHECK: '1', LEERNESS_NO_PATH_CHECK: '1', LEERNESS_LANG: 'en',
      AUDIT_TEXT_LIB: path.resolve(__dirname, '../lib'), AUDIT_TEXT_MODE: opts.mode || '', AUDIT_TEXT_TARGET: opts.target || f[f.key], AUDIT_TEXT_WINNER: Buffer.from(opts.winner || '# Competing edit\n' + sample).toString('base64') }
  });
  assert.ifError(r.error);return r;
}
function success(r) { assert.strictEqual(r.status, 0, r.stdout + r.stderr);assert.strictEqual(r.stderr, '');return JSON.parse(r.stdout); }
function failure(r) { assert.notStrictEqual(r.status, 0, r.stdout + r.stderr);assert.strictEqual(r.stderr, '');return JSON.parse(r.stdout); }
function failedFix(r, f, phase = 'preflight', fixed = 0) {
  const data = failure(r), item = data.findings.find(x => x.kind === 'timestamp_fix_failed');
  assert.ok(item);assert.strictEqual(data.healthy, false);assert.strictEqual(data.incomplete, true);
  assert.strictEqual(data.fixed, fixed);assert.strictEqual(item.completedFixes, fixed);
  assert.strictEqual(item.phase, phase);assert.strictEqual(item.publicationAttempted, phase === 'publication');
  assert.strictEqual(item.file.replace(/\\/g, '/'), path.relative(f.dir, f[f.key]).replace(/\\/g, '/'));
  assert.strictEqual(item.rolledBack, false);return item;
}
function rejectUnchanged(f, opts) { const before = snapshot(f[f.key]), r = call(f, opts);assert.deepStrictEqual(snapshot(f[f.key]), before);return r; }
function retained(dir, bytes) { return fs.readdirSync(dir, { withFileTypes: true }).some(e => { const p = path.join(dir, e.name);return e.isDirectory() ? retained(p, bytes) : e.isFile() && fs.readFileSync(p).equals(bytes); }); }
function tree(dir) { return fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).map(e => [e.name, e.isDirectory() ? tree(path.join(dir, e.name)) : snapshot(path.join(dir, e.name))]); }
for (const key of ['handoff', 'state']) {
  test('repro malformed UTF-8 source is not saved: ' + key, () => {
    const f = fixture(key);fs.appendFileSync(f[key], Buffer.from([0xff]));const before = snapshot(f[key]), r = call(f);
    console.log('Observation: ' + key + ' exit=' + r.status + ' changed=' + (JSON.stringify(snapshot(f[key])) !== JSON.stringify(before)));
    assert.deepStrictEqual(snapshot(f[key]), before);assert.strictEqual(failedFix(r, f).causeCode, 'E_TEXT_ENCODING');
  });
  test('repro stale captured source does not overwrite a competing edit: ' + key, () => {
    const f = fixture(key), winner = '# Competing edit\n' + sample, r = call(f, { mode: 'after-capture', winner });
    assert.strictEqual(text(f[key]), winner);failedFix(r, f);
  });
  test('repro document removed before capture is not recreated: ' + key, () => {
    const f = fixture(key), r = call(f, { mode: 'remove-before' });assert.ok(!fs.existsSync(f[key]));assert.strictEqual(success(r).fixed, 0);
  });
  test('repro already resolved source is not counted as a new fix: ' + key, () => {
    const f = fixture(key), winner = key === 'handoff' ? '# Session handoff\nLast generated: 2026-01-01\n' + sample : '# Current state\nUpdated: ' + today() + '\n' + sample;
    const r = call(f, { mode: 'before-capture', winner });assert.strictEqual(text(f[key]), winner);assert.strictEqual(success(r).fixed, 0);
    assert.strictEqual(fs.statSync(f[key]).mtimeMs, 1000000000000);
  });
  for (const bom of ['', '\uFEFF']) test('Unicode, CRLF and later dates survive first-match edit: ' + key + ' BOM=' + !!bom, () => {
    const f = fixture(key);fs.writeFileSync(f[key], bom + body[key]);const data = success(call(f));
    assert.strictEqual(data.fixed, 1);assert.strictEqual(text(f[key]), bom + fixedBody(key));assert.ok(!data.incomplete);
    assert.ok(data.findings.some(x => x.kind === (key === 'handoff' ? 'handoff_not_generated' : 'current_state_stale')));
  });
  test('truncated UTF-8 refuses the edit: ' + key, () => {
    const f = fixture(key);fs.appendFileSync(f[key], Buffer.from([0xed, 0x95]));assert.strictEqual(failedFix(rejectUnchanged(f), f).causeCode, 'E_TEXT_ENCODING');
  });
  test('over-limit source is preserved: ' + key, () => {
    const f = fixture(key);fs.appendFileSync(f[key], 'x'.repeat(4 * 1024 * 1024));failedFix(rejectUnchanged(f), f);
  });
  test('absence at initial observation stays absent: ' + key, () => {
    const f = fixture(key);fs.unlinkSync(f[key]);assert.strictEqual(success(call(f)).fixed, 0);assert.ok(!fs.existsSync(f[key]));
  });
  test('concurrent eligible text before capture retains new body: ' + key, () => {
    const f = fixture(key), winner = body[key] + '\r\nNew notes ' + sample;
    assert.strictEqual(success(call(f, { mode: 'before-capture', winner })).fixed, 1);assert.strictEqual(text(f[key]), fixedBody(key, winner));
  });
  test('removal after capture is a failure without resurrection: ' + key, () => {
    const f = fixture(key);failedFix(call(f, { mode: 'remove-after' }), f);assert.ok(!fs.existsSync(f[key]));
  });
  test('publisher failure is not a completed fix: ' + key, () => {
    const f = fixture(key);failedFix(rejectUnchanged(f, { mode: 'write-failure' }), f, 'publication');
  });
  test('failure after publication reports uncertainty without claiming rollback: ' + key, () => {
    const f = fixture(key);failedFix(call(f, { mode: 'late-failure' }), f, 'publication');assert.strictEqual(text(f[key]), fixedBody(key));
  });
  test('hard-linked source and alias are preserved: ' + key, () => {
    const f = fixture(key), alias = path.join(f.dir, 'alias');fs.linkSync(f[key], alias);const before = snapshot(alias);
    failedFix(rejectUnchanged(f), f);assert.deepStrictEqual(snapshot(alias), before);
  });
  for (const mode of ['publication', 'after-publication']) test('detected final conflict retains competing text for recovery: ' + key + ' ' + mode, () => {
    const f = fixture(key), winner = '# Competing edit\n' + sample, item = failedFix(call(f, { mode, winner }), f, 'publication');
    assert.ok(retained(f.dir, Buffer.from(winner)));assert.ok(item.outputMutationStarted || item.outputRolledBack);
    if (item.backupFile) assert.ok(fs.existsSync(item.backupFile));
  });
  test('dry-run preserves every project file and modification time: ' + key, () => {
    const f = fixture(key), before = tree(f.dir);failedFix(call(f, { args: ['--fix', '--dry-run'] }), f);assert.deepStrictEqual(tree(f.dir), before);
  });
}
test('both timestamps are saved and counted separately', () => {
  const f = fixture();fs.writeFileSync(f.handoff, body.handoff);assert.strictEqual(success(call(f)).fixed, 2);
  for (const key of ['handoff', 'state']) assert.strictEqual(text(f[key]), fixedBody(key));
});
test('first saved timestamp remains counted when the second fails preflight', () => {
  const f = fixture();fs.writeFileSync(f.handoff, body.handoff);fs.appendFileSync(f.state, Buffer.from([0xff]));const before = snapshot(f.state);
  const item = failedFix(call(f), f, 'preflight', 1);assert.deepStrictEqual(snapshot(f.state), before);
  assert.strictEqual(text(f.handoff), fixedBody('handoff'));assert.deepStrictEqual(item.completedTimestampFiles.map(x => x.replace(/\\/g, '/')), ['.leerness/session-handoff.md']);
});
test('first timestamp failure skips the second timestamp and later README repair', () => {
  const f = fixture('handoff');fs.writeFileSync(f.state, body.state);fs.appendFileSync(f.handoff, Buffer.from([0xff]));
  fs.writeFileSync(path.join(f.dir, 'README.md'), '# Fixture\nbadge/version-0.0.0-green\n');const before = [snapshot(f.state), snapshot(path.join(f.dir, 'README.md'))];
  failedFix(call(f), f);assert.deepStrictEqual([snapshot(f.state), snapshot(path.join(f.dir, 'README.md'))], before);
});
test('human partial failure identifies the affected file and retained earlier save', () => {
  const f = fixture();fs.writeFileSync(f.handoff, body.handoff);fs.appendFileSync(f.state, Buffer.from([0xff]));const r = call(f, { human: true });
  assert.notStrictEqual(r.status, 0);assert.match(r.stdout + r.stderr, /current-state\.md/);assert.match(r.stdout, /Audit incomplete: fixed=1/);assert.match(r.stdout, /not rolled back/);
});
test('inspection without --fix leaves both damaged timestamp sources untouched', () => {
  const f = fixture();fs.writeFileSync(f.handoff, body.handoff);fs.appendFileSync(f.handoff, Buffer.from([0xff]));fs.appendFileSync(f.state, Buffer.from([0xff]));
  const before = tree(f.dir);assert.strictEqual(success(call(f, { args: [] })).fixed, 0);assert.deepStrictEqual(tree(f.dir), before);
});
test('unchanged strict warning policy can fail after successful timestamp saves', () => {
  const f = fixture(), data = failure(call(f, { args: ['--fix', '--strict'] }));assert.strictEqual(data.fixed, 1);
  assert.ok(data.findings.some(x => x.kind === 'strict_promoted'));assert.ok(!data.incomplete);
});
test('force cannot bypass damaged source validation', () => {
  const f = fixture();fs.appendFileSync(f.state, Buffer.from([0xff]));failedFix(rejectUnchanged(f, { args: ['--fix', '--force'] }), f);
});
test('four MiB including BOM fits a same-size state date change', () => {
  const f = fixture(), prefix = '\uFEFF' + body.state, value = prefix + 'x'.repeat(4 * 1024 * 1024 - Buffer.byteLength(prefix));
  fs.writeFileSync(f.state, value);assert.strictEqual(success(call(f)).fixed, 1);assert.strictEqual(text(f.state), fixedBody('state', value));
});
test('handoff stamp growth beyond four MiB is refused', () => {
  const f = fixture('handoff'), prefix = '\uFEFF' + body.handoff, value = prefix + 'x'.repeat(4 * 1024 * 1024 - Buffer.byteLength(prefix));
  fs.writeFileSync(f.handoff, value);assert.strictEqual(failedFix(rejectUnchanged(f), f).causeCode, 'E_TEXT_LIMIT');
});
test('fresh, future and absent state dates keep bytes and modification times', () => {
  for (const date of [today(), new Date(Date.now() - 86400000).toISOString().slice(0, 10), '2099-01-01', 'unknown']) {
    const f = fixture();fs.writeFileSync(f.state, '# Current state\r\nUpdated: ' + date + '\r\n' + sample);const before = snapshot(f.state);
    assert.strictEqual(success(call(f)).fixed, 0);assert.deepStrictEqual(snapshot(f.state), before);
  }
});
test('fresh state supplied before capture is not forcibly dated today', () => {
  const f = fixture(), yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10), winner = '# Current state\r\nUpdated: ' + yesterday + '\r\n' + sample;
  assert.strictEqual(success(call(f, { mode: 'before-capture', winner })).fixed, 0);assert.strictEqual(text(f.state), winner);
});
test('unparseable state date retains existing stale repair policy', () => {
  const f = fixture();fs.writeFileSync(f.state, body.state.replace('2000-01-01', '2000-99-99'));
  assert.strictEqual(success(call(f)).fixed, 1);assert.strictEqual(text(f.state), fixedBody('state'));
});
test('Korean handoff sentinel is supported without rewriting other text', () => {
  const f = fixture('handoff'), value = body.handoff.replace('(auto)', '(자동)');fs.writeFileSync(f.handoff, value);
  assert.strictEqual(success(call(f)).fixed, 1);assert.strictEqual(text(f.handoff), fixedBody('handoff', value));
});
for (const direct of [false, true]) test('canonical lock is held through CLI and library fallback: direct=' + direct, () => {
  const f = fixture();assert.strictEqual(success(call(f, { direct, mode: 'lock-check' })).fixed, 1);assert.strictEqual(text(f.state), fixedBody('state'));
});
console.log(`Tests: ${passed}/${passed + failed} passed`);process.exitCode = failed || passed === 0 ? 1 : 0;
