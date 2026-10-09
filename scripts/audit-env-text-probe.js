'use strict';
const assert = require('assert'), fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process');
const { createHash } = require('crypto');
const { removeTree } = require('./temp-cleanup');
if (!process.argv.includes('--worker')) {
  const arena = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-audit-env-'));
  try {
    const env = { ...process.env, AUDIT_ENV_ROOT: arena };
    for (const key of ['HOME', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA', 'TEMP', 'TMP']) { env[key] = path.join(arena, key.toLowerCase());fs.mkdirSync(env[key]); }
    const r = cp.spawnSync(process.execPath, [__filename, '--worker', ...process.argv.slice(2)], { encoding: 'utf8', timeout: 600000, windowsHide: true, env });
    process.stdout.write(r.stdout || '');process.stderr.write(r.stderr || '');if (r.error) process.stderr.write(r.error.message + '\n');
    process.exitCode = r.status === 0 && !r.error ? 0 : 1;
  } finally {
    const resolved = fs.realpathSync(arena);assert.strictEqual(path.dirname(resolved).toLowerCase(), fs.realpathSync(os.tmpdir()).toLowerCase());
    assert.ok(path.basename(resolved).startsWith('leerness-audit-env-'));removeTree(resolved, { recursive: true, force: true });
  }
  return;
}
const arena = process.env.AUDIT_ENV_ROOT, cli = path.resolve(__dirname, '../bin/leerness.js'), core = require('../bin/leerness');
const sample = '한글 English 日本語 中文 e\u0301 🐝 \uFFFD';
const privateValue = 'invented-value-must-stay-in-source';
const ignorePatterns = ['.env', '.env.local', '.env.production', '.env.*.local', '*.pem', 'credentials.json'];
const completeIgnore = ignorePatterns.join('\n') + '\n';
const body = { gitignore: '# User notes ' + sample + '\r\nnode_modules/\r\n', env: '# User notes ' + sample + '\r\nEXISTING=example\r\n' };
let sequence = 0, passed = 0, failed = 0;
const at = process.argv.indexOf('--match'), filter = at < 0 ? '' : process.argv[at + 1];
function test(name, fn) { if (filter && !name.includes(filter)) return;try { fn();passed++;console.log('PASS ' + name); } catch (e) { failed++;console.error('FAIL ' + name + ': ' + e.stack); } }
function fixture(key = 'gitignore') {
  const dir = path.join(arena, (++sequence) + '-한글 project'), ws = path.join(dir, '.leerness');fs.mkdirSync(ws, { recursive: true });
  for (const [name, value] of Object.entries(core.coreFiles(dir, 'en'))) {
    const file = path.join(dir, name);fs.mkdirSync(path.dirname(file), { recursive: true });fs.writeFileSync(file, value);
  }
  const f = { dir, ws, gi: path.join(dir, '.gitignore'), env: path.join(dir, '.env'), example: path.join(dir, '.env.example'), handoff: path.join(ws, 'session-handoff.md'), key };
  f.target = key === 'gitignore' ? f.gi : f.example;
  fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"audit-env-test","version":"7.8.9"}\n');
  fs.writeFileSync(f.handoff, '# Handoff\nLast generated: 2026-01-01\n');
  fs.writeFileSync(path.join(ws, 'current-state.md'), '# Current state\nUpdated: ' + new Date().toISOString().slice(0, 10) + '\n');
  fs.writeFileSync(f.env, 'EXISTING=' + privateValue + '\nADDED=' + privateValue + '\n');
  fs.writeFileSync(f.gi, key === 'gitignore' ? body.gitignore : completeIgnore);
  fs.writeFileSync(f.example, key === 'env' ? body.env : 'EXISTING=\nADDED=\n');return f;
}
const text = p => fs.readFileSync(p, 'utf8');
function snapshot(file) { if (!fs.existsSync(file)) return null;const s = fs.statSync(file, { bigint: true });return { sha: createHash('sha256').update(fs.readFileSync(file)).digest('hex'), mtime: String(s.mtimeNs) }; }
function tree(dir) { return fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).map(e => [e.name, e.isDirectory() ? tree(path.join(dir, e.name)) : snapshot(path.join(dir, e.name))]); }
function retained(dir, bytes) { return fs.readdirSync(dir, { withFileTypes: true }).some(e => { const p = path.join(dir, e.name);return e.isDirectory() ? retained(p, bytes) : e.isFile() && fs.readFileSync(p).equals(bytes); }); }
const hook = path.join(arena, 'boundary-hook.cjs');
fs.writeFileSync(hook, String.raw`
const fs=require('fs'),path=require('path'),cp=require('child_process'),base=process.env.AUDIT_ENV_LIB,target=process.env.AUDIT_ENV_TARGET,mode=process.env.AUDIT_ENV_MODE;
const write=fs.writeFileSync.bind(fs),bytes=Buffer.from(process.env.AUDIT_ENV_WINNER,'base64');let fired=false;
const locks=require(path.join(base,'state-lock'));
const io=require(path.join(base,'io')),read=io.read,writeUtf8=io.writeUtf8;
const inject=p=>{if(!fired&&p===target){fired=true;if(mode==='remove-before'||mode==='remove-after')fs.unlinkSync(p);else {write(p,bytes);fs.utimesSync(p,1000000000,1000000000);}}};
io.read=function(p){const result=read(p);if(['before-capture','remove-before'].includes(mode))inject(p);if(mode==='presence-remove'&&p===target&&!fired){fired=true;fs.unlinkSync(process.env.AUDIT_ENV_SOURCE);}return result;};
io.writeUtf8=function(p,...a){if(mode==='after-capture')inject(p);if(mode==='write-failure'&&p===target)throw Error('injected audit env publication failure');return writeUtf8(p,...a);};
const mod=require(path.join(base,'managed-text')),capture=mod.captureTextEdit,publish=mod.publishTextEdit;
mod.captureTextEdit=function(p,...a){
  if(mode==='lock-check'&&p===target&&!locks.isStateLockHeld(p))throw Error('canonical audit env lock missing');
  const result=capture(p,...a);if(mode==='after-capture'||mode==='remove-after')inject(p);return result;
};
mod.publishTextEdit=function(s,p,t){
  if(p===target&&mode==='write-failure')throw Error('injected audit env publication failure');
  const result=publish(s,p,t);if(mode==='late-failure'&&p===target)throw Error('injected failure after audit env publication');return result;
};
const input=require(path.join(base,'memory-input')),captureInput=input.captureCheckedFileInput,source=process.env.AUDIT_ENV_SOURCE;
input.captureCheckedFileInput=function(p,...a){
  const selected=p===source&&locks.isStateLockHeld(target)&&!fired;
  if(selected&&mode==='source-before'){fired=true;write(p,Buffer.from(process.env.AUDIT_ENV_SOURCE_WINNER,'base64'));}
  if(selected&&mode==='source-remove'){fired=true;fs.unlinkSync(p);}
  const result=captureInput(p,...a);
  if(selected&&mode==='source-after'){fired=true;write(p,Buffer.from(process.env.AUDIT_ENV_SOURCE_WINNER,'base64'));}return result;
};
const rename=fs.renameSync.bind(fs);fs.renameSync=function(a,b){if(mode==='publication'&&a===target)inject(a);return rename(a,b);};
const spawn=cp.spawnSync.bind(cp);cp.spawnSync=function(a,b,o){if(o?.env?.LEERNESS_REPLACE_TO===target){if(mode==='publication')inject(target);const r=spawn(a,b,o);if(mode==='after-publication'&&r.status===0)inject(target);return r;}return spawn(a,b,o);};
const link=fs.linkSync.bind(fs);fs.linkSync=function(a,b){if(mode==='publication')inject(b);const r=link(a,b);if(mode==='after-publication')inject(b);return r;};
`);
const direct = path.join(arena, 'direct-library.cjs');
fs.writeFileSync(direct, String.raw`
const fs=require('fs'),path=require('path'),base=process.env.AUDIT_ENV_LIB,ws=(r,n)=>path.join(r,'.leerness',n);
require(path.join(base,'audit')).audit(process.argv[3],{json:true},{
  VERSION:require(path.join(base,'../package.json')).version,has:f=>process.argv.includes(f),arg:(k,d)=>d,
  planPath:r=>ws(r,'plan.md'),handoffPath:r=>ws(r,'session-handoff.md'),currentStatePath:r=>ws(r,'current-state.md'),
  readProgressRows:()=>[],envDiff:r=>({envPath:path.join(r,'.env'),examplePath:path.join(r,'.env.example'),inEnvOnly:['ADDED']}),
  _readFeatureGraph:()=>({nodes:[]}),_listAPISkills:()=>[]
});
`);
function call(f, opts = {}) {
  const r = cp.spawnSync(process.execPath, [...(opts.mode ? ['--require', hook] : []), opts.direct ? direct : cli, ...(opts.command || ['audit']), f.dir, ...(opts.args || ['--fix']), ...(opts.human ? [] : ['--json'])], {
    cwd: f.dir, encoding: 'utf8', timeout: 45000, windowsHide: true,
    env: { ...process.env, LEERNESS_INTERNAL: '1', LEERNESS_HOOK: '', LEERNESS_OFFLINE: '1', LEERNESS_NO_AUTOCHCP: '1', LEERNESS_NO_STALE_CHECK: '1', LEERNESS_NO_PATH_CHECK: '1', LEERNESS_LANG: 'en',
      AUDIT_ENV_LIB: path.resolve(__dirname, '../lib'), AUDIT_ENV_MODE: opts.mode || '', AUDIT_ENV_TARGET: f.target, AUDIT_ENV_WINNER: Buffer.from(opts.winner || '# Competing notes\n' + sample).toString('base64'),
      AUDIT_ENV_SOURCE: f.env, AUDIT_ENV_SOURCE_WINNER: Buffer.from(opts.sourceWinner || 'REPLACED=' + privateValue + '\n').toString('base64') }
  });
  assert.ifError(r.error);assert.ok(!(r.stdout + r.stderr).includes(privateValue), 'source values must never enter diagnostic output');return r;
}
function success(r) { assert.strictEqual(r.status, 0, r.stdout + r.stderr);assert.strictEqual(r.stderr, '');return JSON.parse(r.stdout); }
function failedFix(f, r, phase = 'preflight', fixed = 0) {
  assert.notStrictEqual(r.status, 0, r.stdout + r.stderr);assert.strictEqual(r.stderr, '');const data = JSON.parse(r.stdout), item = data.findings.find(x => x.kind === f.key + '_fix_failed');
  assert.ok(item);assert.strictEqual(data.healthy, false);assert.strictEqual(data.incomplete, true);
  assert.strictEqual(data.fixed, fixed);assert.strictEqual(item.completedFixes, fixed);assert.strictEqual(item.file, path.basename(f.target));
  assert.strictEqual(item.phase, phase);assert.strictEqual(item.publicationAttempted, phase === 'publication');assert.strictEqual(item.rolledBack, false);return item;
}
function rejectUnchanged(f, opts) { const before = snapshot(f.target), r = call(f, opts);assert.deepStrictEqual(snapshot(f.target), before);return r; }
for (const key of ['gitignore', 'env']) {
  test('repro malformed output source is not rewritten: ' + key, () => {
    const f = fixture(key);fs.appendFileSync(f.target, Buffer.from([0xff]));const before = snapshot(f.target), r = call(f);
    console.log('Observation: ' + key + ' exit=' + r.status + ' changed=' + (JSON.stringify(snapshot(f.target)) !== JSON.stringify(before)));
    assert.deepStrictEqual(snapshot(f.target), before);assert.strictEqual(failedFix(f, r).causeCode, 'E_TEXT_ENCODING');
  });
  test('repro captured competing target is not overwritten: ' + key, () => {
    const f = fixture(key), winner = '# Competing notes\n' + sample, r = call(f, { mode: 'after-capture', winner });assert.strictEqual(text(f.target), winner);failedFix(f, r);
  });
  test('repro failed save is not reported as healthy: ' + key, () => {
    const f = fixture(key);failedFix(f, rejectUnchanged(f, { mode: 'write-failure' }), 'publication');
  });
  test('repro resolved target does not count a new fix: ' + key, () => {
    const f = fixture(key), winner = key === 'gitignore' ? completeIgnore : 'EXISTING=\nADDED=\n';const r = call(f, { mode: 'before-capture', winner });
    assert.strictEqual(text(f.target), winner);assert.strictEqual(success(r).fixed, 0);assert.strictEqual(fs.statSync(f.target).mtimeMs, 1000000000000);
  });
}
test('repro malformed private source blocks example edit without exposing values', () => {
  const f = fixture('env');fs.appendFileSync(f.env, Buffer.from([0xff]));const source = snapshot(f.env);
  const item = failedFix(f, rejectUnchanged(f));assert.strictEqual(item.sourceFile, '.env');assert.strictEqual(item.causeCode, 'E_TEXT_ENCODING');assert.deepStrictEqual(snapshot(f.env), source);
});
test('repro removed example stays absent', () => {
  const f = fixture('env'), r = call(f, { mode: 'remove-before' });assert.ok(!fs.existsSync(f.target));assert.strictEqual(success(r).fixed, 0);
});
for (const key of ['gitignore', 'env']) {
  for (const bom of ['', '\uFEFF']) test('Unicode, BOM, CRLF and notes preserved: ' + key + ' BOM=' + !!bom, () => {
    const f = fixture(key), value = bom + body[key];fs.writeFileSync(f.target, value);const source = snapshot(f.env), data = success(call(f, { mode: 'lock-check' }));
    assert.strictEqual(data.fixed, 1);assert.ok(!data.incomplete);assert.deepStrictEqual(snapshot(f.env), source);
    const saved = text(f.target);assert.ok(saved.startsWith(value));assert.ok(!saved.includes(privateValue));
    const added = saved.slice(value.length);assert.ok(!added.replace(/\r\n/g, '').includes('\n'));
    for (const entry of key === 'gitignore' ? ignorePatterns : ['ADDED=']) assert.ok(added.includes(entry + '\r\n'));
  });
  test('eligible fresh capture retains concurrent notes: ' + key, () => {
    const f = fixture(key), winner = body[key] + '# New notes ' + sample + '\r\n';
    assert.strictEqual(success(call(f, { mode: 'before-capture', winner })).fixed, 1);assert.ok(text(f.target).startsWith(winner));
  });
  test('truncated UTF-8 target preserved: ' + key, () => {
    const f = fixture(key);fs.appendFileSync(f.target, Buffer.from([0xed, 0x95]));assert.strictEqual(failedFix(f, rejectUnchanged(f)).causeCode, 'E_TEXT_ENCODING');
  });
  test('oversized target input preserved: ' + key, () => {
    const f = fixture(key);fs.appendFileSync(f.target, 'x'.repeat(4 * 1024 * 1024));failedFix(f, rejectUnchanged(f));
  });
  test('candidate exceeding limit including BOM refused: ' + key, () => {
    const f = fixture(key), prefix = '\uFEFF' + body[key];fs.writeFileSync(f.target, prefix + '#'.repeat(4 * 1024 * 1024 - Buffer.byteLength(prefix)));
    assert.strictEqual(failedFix(f, rejectUnchanged(f)).causeCode, 'E_TEXT_LIMIT');
  });
  test('hard-linked target and alias preserved: ' + key, () => {
    const f = fixture(key), alias = path.join(f.dir, 'alias');fs.linkSync(f.target, alias);const before = snapshot(alias);
    failedFix(f, rejectUnchanged(f));assert.deepStrictEqual(snapshot(alias), before);
  });
  test('dry-run does not create lock metadata or touch project: ' + key, () => {
    const f = fixture(key), before = tree(f.dir);failedFix(f, call(f, { args: ['--fix', '--dry-run'] }));assert.deepStrictEqual(tree(f.dir), before);
  });
  test('force cannot bypass damaged target: ' + key, () => {
    const f = fixture(key);fs.appendFileSync(f.target, Buffer.from([0xff]));failedFix(f, rejectUnchanged(f, { args: ['--fix', '--force'] }));
  });
  test('removed captured target not resurrected: ' + key, () => {
    const f = fixture(key);failedFix(f, call(f, { mode: 'remove-after' }));assert.ok(!fs.existsSync(f.target));
  });
  test('late failure admits changed target with no confirmed fix: ' + key, () => {
    const f = fixture(key), before = snapshot(f.target);failedFix(f, call(f, { mode: 'late-failure' }), 'publication');assert.notDeepStrictEqual(snapshot(f.target), before);
  });
  for (const mode of ['publication', 'after-publication']) test('publication conflict retains recovery text: ' + key + ' ' + mode, () => {
    const f = fixture(key), winner = '# Competing notes\n' + sample, item = failedFix(f, call(f, { mode, winner }), 'publication');
    assert.ok(retained(f.dir, Buffer.from(winner)));assert.ok(item.outputMutationStarted || item.outputRolledBack);if (item.backupFile) assert.ok(fs.existsSync(item.backupFile));
  });
  test('repeat repair retains target bytes and mtime: ' + key, () => {
    const f = fixture(key);assert.strictEqual(success(call(f)).fixed, 1);const before = snapshot(f.target);assert.strictEqual(success(call(f)).fixed, 0);assert.deepStrictEqual(snapshot(f.target), before);
  });
  test('strict warnings remain failures after confirmed save: ' + key, () => {
    const r = call(fixture(key), { args: ['--fix', '--strict'] });assert.notStrictEqual(r.status, 0);const data = JSON.parse(r.stdout);
    assert.strictEqual(data.fixed, 1);assert.ok(!data.incomplete);assert.ok(data.findings.some(x => x.kind === 'strict_promoted'));
  });
  test('read-only observation preserves damaged target: ' + key, () => {
    const f = fixture(key);fs.appendFileSync(f.target, Buffer.from([0xff]));const before = tree(f.dir);assert.strictEqual(success(call(f, { args: [] })).fixed, 0);assert.deepStrictEqual(tree(f.dir), before);
  });
  test('disabled check leaves selected damaged target alone: ' + key, () => {
    const f = fixture(key);fs.appendFileSync(f.target, Buffer.from([0xff]));const before = snapshot(f.target);
    assert.strictEqual(success(call(f, { args: ['--fix', key === 'gitignore' ? '--no-gitignore-check' : '--no-env-check'] })).fixed, 0);assert.deepStrictEqual(snapshot(f.target), before);
  });
  test('human failure reports target and uncertainty: ' + key, () => {
    const f = fixture(key), r = call(f, { human: true, mode: 'late-failure' });assert.notStrictEqual(r.status, 0);
    assert.ok((r.stdout + r.stderr).includes(path.basename(f.target) + ' fix failed'));assert.match(r.stdout, /Audit incomplete: fixed=0/);assert.match(r.stdout, /may have changed/);
  });
}
test('absent gitignore created with exact pattern list', () => {
  const f = fixture();fs.unlinkSync(f.target);assert.strictEqual(success(call(f)).fixed, 1);
  assert.deepStrictEqual(text(f.target).split('\n').filter(x => x && !x.startsWith('#')), ignorePatterns);
});
test('new competing gitignore is not overwritten after absent capture', () => {
  const f = fixture(), winner = '# Competing newly created ignore file\n';fs.unlinkSync(f.target);failedFix(f, call(f, { mode: 'after-capture', winner }));assert.strictEqual(text(f.target), winner);
});
test('deleted gitignore before capture uses existing creation policy', () => {
  const f = fixture();assert.strictEqual(success(call(f, { mode: 'remove-before' })).fixed, 1);assert.ok(!text(f.target).includes('User notes'));assert.ok(text(f.target).includes('credentials.json\n'));
});
test('absent example remains absent', () => {
  const f = fixture('env');fs.unlinkSync(f.target);assert.strictEqual(success(call(f)).fixed, 0);assert.ok(!fs.existsSync(f.target));
});
test('absent environment disables both repairs', () => {
  const f = fixture('env');fs.unlinkSync(f.env);fs.unlinkSync(f.gi);const before = tree(f.dir);assert.strictEqual(success(call(f)).fixed, 0);assert.deepStrictEqual(tree(f.dir), before);
});
test('environment disappearance before ignore capture skips repair', () => {
  const f = fixture(), before = snapshot(f.target);assert.strictEqual(success(call(f, { mode: 'presence-remove' })).fixed, 0);assert.deepStrictEqual(snapshot(f.target), before);
});
test('ignore repair does not require decoding private values', () => {
  const f = fixture();fs.appendFileSync(f.env, Buffer.from([0xff]));const before = snapshot(f.env);assert.strictEqual(success(call(f, { args: ['--fix', '--no-env-check'] })).fixed, 1);assert.deepStrictEqual(snapshot(f.env), before);
});
test('existing broad ignore and root-prefixed coverage preserved', () => {
  const f = fixture();fs.writeFileSync(f.target, '/.env*\n/*.pem\n/credentials.json\n');const before = snapshot(f.target);assert.strictEqual(success(call(f)).fixed, 0);assert.deepStrictEqual(snapshot(f.target), before);
});
test('only missing ignore entries appended without normalizing original', () => {
  const f = fixture(), value = '# notes\n/.env\n.env.*\n*.pem\n';fs.writeFileSync(f.target, value);assert.strictEqual(success(call(f)).fixed, 1);
  assert.ok(text(f.target).startsWith(value));assert.deepStrictEqual(text(f.target).slice(value.length).split('\n').filter(x => x && !x.startsWith('#')), ['credentials.json']);
});
test('fresh environment source determines appended keys', () => {
  const f = fixture('env');assert.strictEqual(success(call(f, { mode: 'source-before' })).fixed, 1);assert.ok(text(f.target).includes('REPLACED=\r\n'));assert.ok(!text(f.target).includes('ADDED='));
});
test('changed environment after capture refuses example write', () => {
  const f = fixture('env'), item = failedFix(f, rejectUnchanged(f, { mode: 'source-after' }));assert.strictEqual(item.sourceFile, '.env');assert.match(text(f.env), /^REPLACED=/);
});
test('environment removed before checked read skips example edit', () => {
  const f = fixture('env'), before = snapshot(f.target);assert.strictEqual(success(call(f, { mode: 'source-remove' })).fixed, 0);assert.deepStrictEqual(snapshot(f.target), before);
});
for (const mode of ['oversized', 'truncated', 'hardlink']) test('unsafe environment reference preserved: ' + mode, () => {
  const f = fixture('env');
  if (mode === 'oversized') fs.appendFileSync(f.env, 'x'.repeat(4 * 1024 * 1024));
  if (mode === 'truncated') fs.appendFileSync(f.env, Buffer.from([0xed, 0x95]));
  if (mode === 'hardlink') fs.linkSync(f.env, path.join(f.dir, 'environment-alias'));
  const before = snapshot(f.env), item = failedFix(f, rejectUnchanged(f));assert.strictEqual(item.sourceFile, '.env');assert.deepStrictEqual(snapshot(f.env), before);
});
test('source BOM, Unicode values and existing key parser semantics', () => {
  const f = fixture('env');fs.writeFileSync(f.env, '\uFEFF# notes\r\nEXISTING=' + sample + '\r\nDUP=one\r\nDUP=two\r\nlower =value\r\nexport UNSUPPORTED=x\r\n9BAD=x\r\nBAD-KEY=x\r\n_EMPTY=\r\n');
  const before = snapshot(f.env);assert.strictEqual(success(call(f)).fixed, 1);assert.deepStrictEqual(snapshot(f.env), before);
  const added = text(f.target).slice(body.env.length).split('\r\n').filter(x => x && !x.startsWith('#'));assert.deepStrictEqual(added, ['DUP=', 'lower=', '_EMPTY=']);
});
test('environment source at exact input limit still supplies keys', () => {
  const f = fixture('env'), prefix = '\uFEFFEXISTING=x\nADDED=x\n#';fs.writeFileSync(f.env, prefix + 'x'.repeat(4 * 1024 * 1024 - Buffer.byteLength(prefix)));
  assert.strictEqual(success(call(f)).fixed, 1);assert.ok(text(f.target).includes('ADDED=\r\n'));
});
test('earlier date README and ignore saves remain reported on example failure', () => {
  const f = fixture('env');fs.writeFileSync(f.handoff, '# Handoff\nLast generated: (auto)\n');fs.writeFileSync(path.join(f.dir, 'README.md'), 'badge/version-0.0.1-blue\n');fs.writeFileSync(f.gi, '');fs.appendFileSync(f.target, Buffer.from([0xff]));
  const item = failedFix(f, rejectUnchanged(f), 'preflight', 3);assert.deepStrictEqual(item.completedReadmeFixes, ['badge']);assert.deepStrictEqual(item.completedEnvironmentFiles, ['.gitignore']);
  assert.deepStrictEqual(item.completedTimestampFiles.map(x => x.replace(/\\/g, '/')), ['.leerness/session-handoff.md']);assert.ok(text(f.gi).includes('credentials.json'));assert.ok(!text(f.handoff).includes('(auto)'));
});
test('ignore failure stops later environment edit', () => {
  const f = fixture();fs.writeFileSync(f.example, 'EXISTING=\n');fs.appendFileSync(f.target, Buffer.from([0xff]));const before = snapshot(f.example), r = call(f);
  failedFix(f, r);assert.deepStrictEqual(snapshot(f.example), before);assert.ok(!JSON.parse(r.stdout).findings.some(x => x.kind === 'env_keys_missing'));
});
for (const key of ['gitignore', 'env']) {
  test('direct library fallback uses canonical target lock: ' + key, () => {
    const f = fixture(key);assert.strictEqual(success(call(f, { direct: true, mode: 'lock-check' })).fixed, 1);assert.ok(text(f.target).startsWith(body[key]));
  });
  test('last line without terminator remains exact before append: ' + key, () => {
    const f = fixture(key), value = body[key].trimEnd();fs.writeFileSync(f.target, value);assert.strictEqual(success(call(f)).fixed, 1);assert.ok(text(f.target).startsWith(value + '\r\n\r\n# audit --fix:'));
  });
}
test('env check shares the original key grammar without exposing values', () => {
  const f = fixture('env');fs.writeFileSync(f.env, '\uFEFFEXISTING=' + privateValue + '\nDUP=x\nDUP=y\nlower=x\nexport NO=x\n9BAD=x\n_EMPTY=\n');
  const before = tree(f.dir), r = call(f, { command: ['env', 'check'], args: [] });assert.notStrictEqual(r.status, 0);const d = JSON.parse(r.stdout);
  assert.deepStrictEqual(d.envKeys, ['EXISTING', 'DUP', 'lower', '_EMPTY']);assert.deepStrictEqual(d.inEnvOnly, ['DUP', 'lower', '_EMPTY']);assert.deepStrictEqual(tree(f.dir), before);
});
console.log(`Tests: ${passed}/${passed + failed} passed`);process.exitCode = failed ? 1 : 0;
