'use strict';
const assert = require('assert'), fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process');
const { createHash } = require('crypto');
const { removeTree } = require('./temp-cleanup');
if (!process.argv.includes('--worker')) {
  const arena = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-audit-readme-'));
  try {
    const env = { ...process.env, AUDIT_README_ROOT: arena };
    for (const key of ['HOME', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA', 'TEMP', 'TMP']) { env[key] = path.join(arena, key.toLowerCase());fs.mkdirSync(env[key]); }
    const r = cp.spawnSync(process.execPath, [__filename, '--worker', ...process.argv.slice(2)], { encoding: 'utf8', timeout: 600000, windowsHide: true, env });
    process.stdout.write(r.stdout || '');process.stderr.write(r.stderr || '');if (r.error) process.stderr.write(r.error.message + '\n');
    process.exitCode = r.status === 0 && !r.error ? 0 : 1;
  } finally {
    const resolved = fs.realpathSync(arena);assert.strictEqual(path.dirname(resolved).toLowerCase(), fs.realpathSync(os.tmpdir()).toLowerCase());
    assert.ok(path.basename(resolved).startsWith('leerness-audit-readme-'));removeTree(resolved, { recursive: true, force: true });
  }
  return;
}
const arena = process.env.AUDIT_README_ROOT, cli = path.resolve(__dirname, '../bin/leerness.js');
const version = require('../package.json').version, core = require('../bin/leerness');
const sample = '한글 English 日本語 中文 e\u0301 🐝 \uFFFD';
const body = {
  badge: '# Project README\r\nbadge/version-0.0.1-blue\r\n\r\n## Notes\r\n' + sample + '\r\n',
  stamp: '# Project README\r\nLast synced by Leerness v0.0.1: 2000-01-01\r\n\r\n## Notes\r\n' + sample + '\r\n'
};
function fixedBody(key, value = body[key], projectVersion = '7.8.9') {
  return key === 'badge' ? value.replace(/badge\/version-[\d.]+-(green|blue|red)/g, () => 'badge/version-' + projectVersion + '-green') : value.replace(/Last synced by Leerness v\d+\.\d+\.\d+/g, () => 'Last synced by Leerness v' + version);
}
let sequence = 0, passed = 0, failed = 0;
const at = process.argv.indexOf('--match'), filter = at < 0 ? '' : process.argv[at + 1];
function test(name, fn) { if (filter && !name.includes(filter)) return;try { fn();passed++;console.log('PASS ' + name); } catch (e) { failed++;console.error('FAIL ' + name + ': ' + e.stack); } }
function fixture(key = 'badge') {
  const dir = path.join(arena, (++sequence) + '-한글 project'), ws = path.join(dir, '.leerness');fs.mkdirSync(ws, { recursive: true });
  for (const [name, value] of Object.entries(core.coreFiles(dir, 'en'))) {
    const file = path.join(dir, name);fs.mkdirSync(path.dirname(file), { recursive: true });fs.writeFileSync(file, value);
  }
  const f = { dir, ws, readme: path.join(dir, 'README.md'), pkg: path.join(dir, 'package.json'), handoff: path.join(ws, 'session-handoff.md'), state: path.join(ws, 'current-state.md'), key };
  fs.writeFileSync(f.pkg, '{"name":"audit-readme-test","version":"7.8.9"}\n');
  fs.writeFileSync(path.join(dir, '.gitignore'), '.env\n.env.*\n');
  fs.writeFileSync(f.handoff, '# Session handoff\nLast generated: 2026-01-01\n\n## Notes\n' + sample + '\n');
  fs.writeFileSync(f.state, '# Current state\nUpdated: ' + new Date().toISOString().slice(0, 10) + '\n\n## Notes\n' + sample + '\n');
  fs.writeFileSync(f.readme, body[key]);return f;
}
const text = p => fs.readFileSync(p, 'utf8');
function snapshot(file) { if (!fs.existsSync(file)) return null;const s = fs.statSync(file, { bigint: true });return { sha: createHash('sha256').update(fs.readFileSync(file)).digest('hex'), mtime: String(s.mtimeNs) }; }
const hook = path.join(arena, 'boundary-hook.cjs');
fs.writeFileSync(hook, String.raw`
const fs=require('fs'),path=require('path'),cp=require('child_process'),base=process.env.AUDIT_README_LIB,target=process.env.AUDIT_README_TARGET,mode=process.env.AUDIT_README_MODE;
const write=fs.writeFileSync.bind(fs),bytes=Buffer.from(process.env.AUDIT_README_WINNER,'base64');let fired=false,publications=0;
const locks=require(path.join(base,'state-lock'));
const io=require(path.join(base,'io')),read=io.read,writeUtf8=io.writeUtf8;
const inject=p=>{if(!fired&&p===target){fired=true;if(mode==='remove-before'||mode==='remove-after')fs.unlinkSync(p);else {write(p,bytes);fs.utimesSync(p,1000000000,1000000000);}}};
io.read=function(p){const result=read(p);if(['before-capture','remove-before'].includes(mode))inject(p);return result;};
io.writeUtf8=function(p,...a){if(mode==='after-capture')inject(p);if(mode==='write-failure'&&p===target)throw Error('injected README publication failure');return writeUtf8(p,...a);};
const mod=require(path.join(base,'managed-text')),capture=mod.captureTextEdit,publish=mod.publishTextEdit;
// Both boundaries inject after the candidate's source was read, before saving.
mod.captureTextEdit=function(p,...a){
  if(mode==='lock-check'&&p===target&&!locks.isStateLockHeld(p))throw Error('canonical README lock missing');
  const result=capture(p,...a);if(mode==='after-capture'||mode==='remove-after')inject(p);return result;
};
mod.publishTextEdit=function(s,p,t){
  if(p===target){publications++;if(mode==='write-failure'||(mode==='second-publish'&&publications===2))throw Error('injected README publication failure');}
  const result=publish(s,p,t);if(mode==='late-failure'&&p===target)throw Error('injected failure after README publication');return result;
};
const input=require(path.join(base,'memory-input')),captureInput=input.captureCheckedFileInput,pkg=process.env.AUDIT_README_PACKAGE;
input.captureCheckedFileInput=function(p,...a){
  const selected=p===pkg&&locks.isStateLockHeld(target)&&!fired;
  if(selected&&mode==='package-before'){fired=true;write(p,Buffer.from(process.env.AUDIT_README_PACKAGE_WINNER,'base64'));}
  if(selected&&mode==='package-remove'){fired=true;fs.unlinkSync(p);}
  const result=captureInput(p,...a);
  if(selected&&mode==='package-after'){fired=true;write(p,Buffer.from(process.env.AUDIT_README_PACKAGE_WINNER,'base64'));}return result;
};
const rename=fs.renameSync.bind(fs);fs.renameSync=function(a,b){if(mode==='publication'&&a===target)inject(a);return rename(a,b);};
const spawn=cp.spawnSync.bind(cp);cp.spawnSync=function(a,b,o){if(o?.env?.LEERNESS_REPLACE_TO===target){if(mode==='publication')inject(target);const r=spawn(a,b,o);if(mode==='after-publication'&&r.status===0)inject(target);return r;}return spawn(a,b,o);};
const link=fs.linkSync.bind(fs);fs.linkSync=function(a,b){if(mode==='publication')inject(b);const r=link(a,b);if(mode==='after-publication')inject(b);return r;};
`);
function call(f, opts = {}) {
  const r = cp.spawnSync(process.execPath, [...(opts.mode ? ['--require', hook] : []), cli, 'audit', f.dir, ...(opts.args || ['--fix']), ...(opts.human ? [] : ['--json'])], {
    cwd: f.dir, encoding: 'utf8', timeout: 45000, windowsHide: true,
    env: { ...process.env, LEERNESS_INTERNAL: '1', LEERNESS_HOOK: '', LEERNESS_OFFLINE: '1', LEERNESS_NO_AUTOCHCP: '1', LEERNESS_NO_STALE_CHECK: '1', LEERNESS_NO_PATH_CHECK: '1', LEERNESS_LANG: 'en',
      AUDIT_README_LIB: path.resolve(__dirname, '../lib'), AUDIT_README_MODE: opts.mode || '', AUDIT_README_TARGET: f.readme, AUDIT_README_WINNER: Buffer.from(opts.winner || '# Competing README\n' + sample).toString('base64'),
      AUDIT_README_PACKAGE: f.pkg, AUDIT_README_PACKAGE_WINNER: Buffer.from(opts.packageWinner || '{"version":"8.9.0"}\n').toString('base64') }
  });
  assert.ifError(r.error);return r;
}
function success(r) { assert.strictEqual(r.status, 0, r.stdout + r.stderr);assert.strictEqual(r.stderr, '');return JSON.parse(r.stdout); }
function failure(r) { assert.notStrictEqual(r.status, 0, r.stdout + r.stderr);assert.strictEqual(r.stderr, '');return JSON.parse(r.stdout); }
function failedFix(r, phase = 'preflight', fixed = 0) {
  const data = failure(r), item = data.findings.find(x => x.kind === 'readme_fix_failed');
  assert.ok(item);assert.strictEqual(data.healthy, false);assert.strictEqual(data.incomplete, true);
  assert.strictEqual(data.fixed, fixed);assert.strictEqual(item.completedFixes, fixed);assert.strictEqual(item.file, 'README.md');
  assert.strictEqual(item.phase, phase);assert.strictEqual(item.publicationAttempted, phase === 'publication');
  assert.strictEqual(item.rolledBack, false);return item;
}
function rejectUnchanged(f, opts) { const before = snapshot(f.readme), r = call(f, opts);assert.deepStrictEqual(snapshot(f.readme), before);return r; }
function retained(dir, bytes) { return fs.readdirSync(dir, { withFileTypes: true }).some(e => { const p = path.join(dir, e.name);return e.isDirectory() ? retained(p, bytes) : e.isFile() && fs.readFileSync(p).equals(bytes); }); }
function tree(dir) { return fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).map(e => [e.name, e.isDirectory() ? tree(path.join(dir, e.name)) : snapshot(path.join(dir, e.name))]); }
for (const key of ['badge', 'stamp']) {
  test('repro malformed README is not rewritten: ' + key, () => {
    const f = fixture(key);fs.appendFileSync(f.readme, Buffer.from([0xff]));const before = snapshot(f.readme), r = call(f);
    console.log('Observation: ' + key + ' exit=' + r.status + ' changed=' + (JSON.stringify(snapshot(f.readme)) !== JSON.stringify(before)));
    assert.deepStrictEqual(snapshot(f.readme), before);assert.strictEqual(failedFix(r).causeCode, 'E_TEXT_ENCODING');
  });
  test('repro captured competing README is not overwritten: ' + key, () => {
    const f = fixture(key), winner = '# Competing README\n' + sample, r = call(f, { mode: 'after-capture', winner });
    assert.strictEqual(text(f.readme), winner);failedFix(r);
  });
  test('repro removed README stays absent: ' + key, () => {
    const f = fixture(key), r = call(f, { mode: 'remove-before' });assert.ok(!fs.existsSync(f.readme));assert.strictEqual(success(r).fixed, 0);
  });
  test('repro failed README save is not reported as healthy: ' + key, () => {
    const f = fixture(key), before = snapshot(f.readme);failedFix(call(f, { mode: 'write-failure' }), 'publication');assert.deepStrictEqual(snapshot(f.readme), before);
  });
  test('repro already resolved README does not count a new fix: ' + key, () => {
    const f = fixture(key), winner = fixedBody(key) + '\r\nResolved elsewhere';
    const r = call(f, { mode: 'before-capture', winner });assert.strictEqual(text(f.readme), winner);assert.strictEqual(success(r).fixed, 0);
    assert.strictEqual(fs.statSync(f.readme).mtimeMs, 1000000000000);
  });
  for (const bom of ['', '\uFEFF']) test('Unicode, BOM, CRLF and user notes survive: ' + key + ' BOM=' + !!bom, () => {
    const f = fixture(key);fs.writeFileSync(f.readme, bom + body[key]);const pkgBefore = snapshot(f.pkg), data = success(call(f));
    assert.strictEqual(data.fixed, 1);assert.strictEqual(text(f.readme), bom + fixedBody(key));assert.deepStrictEqual(snapshot(f.pkg), pkgBefore);assert.ok(!data.incomplete);
  });
  test('oversized README input is preserved: ' + key, () => {
    const f = fixture(key);fs.appendFileSync(f.readme, 'x'.repeat(4 * 1024 * 1024));failedFix(rejectUnchanged(f));
  });
  test('truncated UTF-8 README input is preserved: ' + key, () => {
    const f = fixture(key);fs.appendFileSync(f.readme, Buffer.from([0xed, 0x95]));assert.strictEqual(failedFix(rejectUnchanged(f)).causeCode, 'E_TEXT_ENCODING');
  });
  test('eligible competing text before capture retains user edits: ' + key, () => {
    const f = fixture(key), winner = body[key] + '\r\nNew notes ' + sample;
    assert.strictEqual(success(call(f, { mode: 'before-capture', winner })).fixed, 1);assert.strictEqual(text(f.readme), fixedBody(key, winner));
  });
  test('removal after capture fails without resurrection: ' + key, () => {
    const f = fixture(key);failedFix(call(f, { mode: 'remove-after' }));assert.ok(!fs.existsSync(f.readme));
  });
  test('failure after publication reports uncertainty and keeps changed target: ' + key, () => {
    const f = fixture(key);failedFix(call(f, { mode: 'late-failure' }), 'publication');assert.strictEqual(text(f.readme), fixedBody(key));
  });
  test('hard-linked README and alias are preserved: ' + key, () => {
    const f = fixture(key), alias = path.join(f.dir, 'alias');fs.linkSync(f.readme, alias);const before = snapshot(alias);
    failedFix(rejectUnchanged(f));assert.deepStrictEqual(snapshot(alias), before);
  });
  test('dry-run preserves all project bytes and modification times: ' + key, () => {
    const f = fixture(key), before = tree(f.dir);failedFix(call(f, { args: ['--fix', '--dry-run'] }));assert.deepStrictEqual(tree(f.dir), before);
  });
  for (const mode of ['publication', 'after-publication']) test('final detected conflict retains competing text for recovery: ' + key + ' ' + mode, () => {
    const f = fixture(key), winner = '# Competing README\n' + sample, item = failedFix(call(f, { mode, winner }), 'publication');
    assert.ok(retained(f.dir, Buffer.from(winner)));assert.ok(item.outputMutationStarted || item.outputRolledBack);
    if (item.backupFile) assert.ok(fs.existsSync(item.backupFile));
  });
}
test('repro unsupported badge color is not a saved fix', () => {
  const f = fixture();fs.writeFileSync(f.readme, body.badge.replace('-blue', '-orange'));const before = snapshot(f.readme);
  assert.strictEqual(success(call(f)).fixed, 0);assert.deepStrictEqual(snapshot(f.readme), before);
});
test('repro invalid package JSON is reported when fixing README versions', () => {
  const f = fixture();fs.writeFileSync(f.pkg, '{broken');const before = snapshot(f.readme);
  const item = failedFix(call(f));assert.strictEqual(item.sourceFile, 'package.json');assert.strictEqual(item.causeCode, 'E_AUDIT_PACKAGE');assert.deepStrictEqual(snapshot(f.readme), before);
});
test('both fixes use distinct versions and retain original dates', () => {
  const f = fixture(), value = body.badge + body.stamp;fs.writeFileSync(f.readme, value);
  assert.strictEqual(success(call(f)).fixed, 2);assert.strictEqual(text(f.readme), fixedBody('stamp', fixedBody('badge', value)));
});
test('second README save failure retains first saved fix and skips later gitignore repair', () => {
  const f = fixture(), value = body.badge + body.stamp;fs.writeFileSync(f.readme, value);
  fs.writeFileSync(path.join(f.dir, '.env'), 'AUDIT_FIXTURE_VALUE=example\n');fs.writeFileSync(path.join(f.dir, '.gitignore'), '');const before = snapshot(path.join(f.dir, '.gitignore'));
  const item = failedFix(call(f, { mode: 'second-publish' }), 'publication', 1);
  assert.deepStrictEqual(item.completedReadmeFixes, ['badge']);assert.strictEqual(text(f.readme), fixedBody('badge', value));assert.deepStrictEqual(snapshot(path.join(f.dir, '.gitignore')), before);
});
test('README failure retains an earlier completed timestamp fix', () => {
  const f = fixture();fs.writeFileSync(f.handoff, '# Handoff\nLast generated: (auto)\n');fs.appendFileSync(f.readme, Buffer.from([0xff]));
  const item = failedFix(call(f), 'preflight', 1);assert.deepStrictEqual(item.completedTimestampFiles.map(x => x.replace(/\\/g, '/')), ['.leerness/session-handoff.md']);
  assert.deepStrictEqual(item.completedReadmeFixes, []);assert.ok(!text(f.handoff).includes('(auto)'));
});
test('human partial failure identifies README and completed save', () => {
  const f = fixture();fs.writeFileSync(f.readme, body.badge + body.stamp);const r = call(f, { human: true, mode: 'second-publish' });
  assert.notStrictEqual(r.status, 0);assert.match(r.stdout + r.stderr, /README fix failed/);assert.match(r.stdout, /Audit incomplete: fixed=1/);assert.match(r.stdout, /not rolled back/);
});
test('read-only observation does not alter damaged README', () => {
  const f = fixture();fs.appendFileSync(f.readme, Buffer.from([0xff]));const before = tree(f.dir);
  assert.strictEqual(success(call(f, { args: [] })).fixed, 0);assert.deepStrictEqual(tree(f.dir), before);
});
test('strict warnings still fail after a confirmed README fix', () => {
  const data = failure(call(fixture(), { args: ['--fix', '--strict'] }));assert.strictEqual(data.fixed, 1);
  assert.ok(data.findings.some(x => x.kind === 'strict_promoted'));assert.ok(!data.incomplete);
});
test('force cannot bypass README source checks', () => {
  const f = fixture();fs.appendFileSync(f.readme, Buffer.from([0xff]));failedFix(rejectUnchanged(f, { args: ['--fix', '--force'] }));
});
test('source fits four MiB but oversized prepared stamp is refused', () => {
  const f = fixture('stamp'), prefix = '\uFEFF' + body.stamp, value = prefix + 'x'.repeat(4 * 1024 * 1024 - Buffer.byteLength(prefix));fs.writeFileSync(f.readme, value);
  assert.strictEqual(failedFix(rejectUnchanged(f)).causeCode, 'E_TEXT_LIMIT');
});
test('exactly four MiB including BOM permits a same-size badge change', () => {
  const f = fixture(), prefix = '\uFEFF' + body.badge.replace('-blue', '-green'), value = prefix + 'x'.repeat(4 * 1024 * 1024 - Buffer.byteLength(prefix));fs.writeFileSync(f.readme, value);
  assert.strictEqual(success(call(f)).fixed, 1);assert.strictEqual(text(f.readme), fixedBody('badge', value));
});
test('malformed, oversized and non-object package inputs refuse README repair', () => {
  for (const bytes of [Buffer.concat([Buffer.from('{"version":"7.8.9"}'), Buffer.from([0xff])]), Buffer.from('{"version":"7.8.9"}' + ' '.repeat(4 * 1024 * 1024)), Buffer.from('null')]) {
    const f = fixture();fs.writeFileSync(f.pkg, bytes);const before = snapshot(f.pkg);const item = failedFix(rejectUnchanged(f));
    assert.strictEqual(item.sourceFile, 'package.json');assert.deepStrictEqual(snapshot(f.pkg), before);
  }
});
test('package BOM and Unicode metadata are accepted without changing the package', () => {
  const f = fixture();fs.writeFileSync(f.pkg, '\uFEFF' + JSON.stringify({ version: '7.8.9', description: sample }));const before = snapshot(f.pkg);
  assert.strictEqual(success(call(f)).fixed, 1);assert.deepStrictEqual(snapshot(f.pkg), before);
});
test('changed package version before locked capture is used', () => {
  const f = fixture();assert.strictEqual(success(call(f, { mode: 'package-before' })).fixed, 1);assert.strictEqual(text(f.readme), fixedBody('badge', body.badge, '8.9.0'));
});
test('changed captured package is refused before publishing README', () => {
  const f = fixture(), item = failedFix(rejectUnchanged(f, { mode: 'package-after' }));assert.strictEqual(item.sourceFile, 'package.json');assert.strictEqual(item.causeCode, 'E_STORE_CHANGED');
  assert.strictEqual(JSON.parse(text(f.pkg)).version, '8.9.0');
});
test('package removed before locked capture skips both README fixes', () => {
  const f = fixture();fs.writeFileSync(f.readme, body.badge + body.stamp);const before = snapshot(f.readme);
  assert.strictEqual(success(call(f, { mode: 'package-remove' })).fixed, 0);assert.deepStrictEqual(snapshot(f.readme), before);assert.ok(!fs.existsSync(f.pkg));
});
test('non-string package versions are not coerced into a badge', () => {
  for (const value of [123, 0, null, [], {}]) {
    const f = fixture();fs.writeFileSync(f.pkg, JSON.stringify({ version: value }));assert.strictEqual(failedFix(rejectUnchanged(f)).causeCode, 'E_AUDIT_VERSION');
  }
});
test('missing or empty package version skips the badge but still allows the tool stamp', () => {
  for (const pkg of [{}, { version: '' }]) {
    const f = fixture(), value = body.badge + body.stamp;fs.writeFileSync(f.readme, value);fs.writeFileSync(f.pkg, JSON.stringify(pkg));
    assert.strictEqual(success(call(f)).fixed, 1);assert.strictEqual(text(f.readme), fixedBody('stamp', value));
  }
});
test('invalid JSON reporting does not echo unrelated package content', () => {
  const f = fixture(), privateText = 'opaque package fixture text';fs.writeFileSync(f.pkg, '{"privateNote":"' + privateText + '", broken');const r = rejectUnchanged(f);
  failedFix(r);assert.ok(!r.stdout.includes(privateText));
});
test('package version substitution uses literal text', () => {
  const f = fixture(), projectVersion = '7.8.9-$&';fs.writeFileSync(f.pkg, JSON.stringify({ version: projectVersion }));
  assert.strictEqual(success(call(f)).fixed, 1);assert.strictEqual(text(f.readme), fixedBody('badge', body.badge, projectVersion));
});
test('absent README or package is not created', () => {
  for (const field of ['readme', 'pkg']) { const f = fixture();fs.unlinkSync(f[field]);const before = tree(f.dir);assert.strictEqual(success(call(f)).fixed, 0);assert.deepStrictEqual(tree(f.dir), before); }
});
test('first matching version keeps existing trigger policy', () => {
  const f = fixture(), value = fixedBody('badge') + body.badge + fixedBody('stamp') + body.stamp;fs.writeFileSync(f.readme, value);const before = snapshot(f.readme);
  assert.strictEqual(success(call(f)).fixed, 0);assert.deepStrictEqual(snapshot(f.readme), before);
});
test('all supported badge colors and stamp occurrences follow existing replacement policy', () => {
  const f = fixture(), value = body.badge + 'badge/version-0.0.2-red\r\nbadge/version-0.0.3-green\r\nbadge/version-0.0.4-orange\r\n' + body.stamp + body.stamp;
  fs.writeFileSync(f.readme, value);assert.strictEqual(success(call(f)).fixed, 2);assert.strictEqual(text(f.readme), fixedBody('stamp', fixedBody('badge', value)));
});
test('README capture uses the canonical lock', () => { assert.strictEqual(success(call(fixture(), { mode: 'lock-check' })).fixed, 1); });
console.log(`Tests: ${passed}/${passed + failed} passed`);process.exitCode = failed || passed === 0 ? 1 : 0;
