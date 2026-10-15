'use strict';
require('./temp-cleanup').trackTemp(module); // T-0357: records this run's temp folders; the runner that started it removes them after a clean exit
const assert = require('assert'), fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process');
const { createHash } = require('crypto');
const { removeTree } = require('./temp-cleanup');
if (!process.argv.includes('--worker')) {
  const arena = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-install-text-'));
  try {
    const env = { ...process.env, INSTALL_PROBE_ROOT: arena };
    for (const key of ['HOME', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA', 'TEMP', 'TMP']) { env[key] = path.join(arena, key.toLowerCase());fs.mkdirSync(env[key]); }
    const r = cp.spawnSync(process.execPath, [__filename, '--worker', ...process.argv.slice(2)], { encoding: 'utf8', timeout: 600000, windowsHide: true, env });
    process.stdout.write(r.stdout || '');process.stderr.write(r.stderr || '');if (r.error) process.stderr.write(r.error.message + '\n');
    process.exitCode = r.status === 0 && !r.error ? 0 : 1;
  } finally {
    const resolved = fs.realpathSync(arena);assert.strictEqual(path.dirname(resolved).toLowerCase(), fs.realpathSync(os.tmpdir()).toLowerCase());
    assert.ok(path.basename(resolved).startsWith('leerness-install-text-'));removeTree(resolved, { recursive: true, force: true });
  }
  return;
}
const arena = process.env.INSTALL_PROBE_ROOT, cli = path.resolve(__dirname, '../bin/leerness.js');
const sample = '한글 English 日本語 中文 🐝 e\u0301 \uFFFD', authored = '# Authored ' + sample + '\r\n';
let sequence = 0, passed = 0, failed = 0;
const at = process.argv.indexOf('--match'), filter = at < 0 ? '' : process.argv[at + 1];
function test(name, fn) { if (filter && !name.includes(filter)) return;try { fn();passed++;console.log('PASS ' + name); } catch (e) { failed++;console.error('FAIL ' + name + ': ' + e.stack); } }
function state(file) { if (!fs.existsSync(file)) return null;const s = fs.statSync(file, { bigint: true });return { sha: createHash('sha256').update(fs.readFileSync(file)).digest('hex'), mtime: String(s.mtimeNs) }; }
function fixture(name, value = authored) {
  const dir = path.join(arena, (++sequence) + '-한글 project'), ws = path.join(dir, '.leerness');fs.mkdirSync(ws, { recursive: true });
  fs.writeFileSync(path.join(ws, 'HARNESS_VERSION'), require('../package.json').version);fs.writeFileSync(path.join(ws, 'LANGUAGE'), 'en');
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'install-text-test', version: '1.0.0' }));
  const file = path.join(dir, name);if (value !== null) fs.writeFileSync(file, value);
  return { dir, ws, file };
}
const hook = path.join(arena, 'boundary-hook.cjs');
fs.writeFileSync(hook, String.raw`
const fs=require('fs'),cp=require('child_process'),path=require('path'),base=process.env.INSTALL_LIB,target=process.env.INSTALL_TARGET,mode=process.env.INSTALL_MODE;
const write=fs.writeFileSync.bind(fs),bytes=Buffer.from(process.env.INSTALL_WINNER,'base64');let fired=false;
const inject=p=>{if(!fired&&p===target){fired=true;write(p,bytes);}};
const io=require(path.join(base,'io')),read=io.read;
io.read=function(p){const result=read(p);if(mode==='after-capture')inject(p);return result;};
const mod=require(path.join(base,'managed-text')),capture=mod.captureTextEdit,publish=mod.publishTextEdit;let publications=0;
mod.captureTextEdit=function(p){if(mode==='before-capture')inject(p);const result=capture(p);if(mode==='after-capture')inject(p);return result;};
mod.publishTextEdit=function(s,p,t){if(p===target){publications++;if(mode==='copy-failure'&&publications===2)throw Error('injected config copy refusal');if(mode==='surrogate')t+='\uD800';if(mode==='oversize')t='a'.repeat(4*1024*1024+1);}return publish(s,p,t);};
const rename=fs.renameSync.bind(fs);fs.renameSync=function(a,b){if(mode==='publication'&&a===target)inject(a);return rename(a,b);};
const open=fs.openSync.bind(fs);fs.openSync=function(p,flags,...rest){if(mode==='publication'&&p===target&&flags==='wx')inject(p);return open(p,flags,...rest);};
const spawn=cp.spawnSync.bind(cp);cp.spawnSync=function(a,b,o){if(o?.env?.LEERNESS_REPLACE_TO===target){if(mode==='publication')inject(target);return spawn(a,b,o);}return spawn(a,b,o);};
const link=fs.linkSync.bind(fs);fs.linkSync=function(a,b){if(mode==='publication')inject(b);return link(a,b);};
`);
const init = (f, env = false) => ['init', f.dir, '--yes', ...(env ? [] : ['--minimal']), '--no-setup-agents', '--no-mcp', '--no-auto-roadmap', '--no-official-skills', '--no-banner'];
const command = f => path.basename(f.file) === 'README.md' ? ['readme', 'sync', f.dir] : init(f, path.basename(f.file) === '.env' || path.basename(f.file) === '.env.example');
function call(f, args = command(f), opts = {}) {
  const r = cp.spawnSync(process.execPath, [...(opts.mode ? ['--require', hook] : []), cli, ...args], {
    cwd: f.dir, encoding: 'utf8', timeout: 90000, windowsHide: true,
    env: { ...process.env, LEERNESS_INTERNAL: '1', LEERNESS_OFFLINE: '1', LEERNESS_NO_AUTOCHCP: '1', LEERNESS_NO_STALE_CHECK: '1', LEERNESS_NO_PATH_CHECK: '1',
      INSTALL_LIB: path.resolve(__dirname, '../lib'), INSTALL_MODE: opts.mode || '', INSTALL_TARGET: opts.target || f.file, INSTALL_WINNER: Buffer.from('competing ' + sample).toString('base64') } });
  assert.ifError(r.error);return r;
}
const text = file => fs.readFileSync(file, 'utf8'), success = r => assert.strictEqual(r.status, 0, r.stdout + r.stderr);
function failure(r) { assert.notStrictEqual(r.status, 0, r.stdout + r.stderr);return r; }
function rejectUnchanged(f, args, opts) { const before = state(f.file), r = call(f, args, opts);assert.deepStrictEqual(state(f.file), before, 'original bytes and mtime must survive refusal');failure(r);return r; }
const targets = ['.gitignore', '.gitattributes', '.env.example', '.env', 'README.md', '.leerness/migration-report.md'];
for (const name of targets) test('rejects malformed ' + name, () => { rejectUnchanged(fixture(name, Buffer.concat([Buffer.from(authored), Buffer.from([0xff])]))); });
test('rejects malformed env during skipped environment generation', () => {
  const f = fixture('.env', Buffer.concat([Buffer.from('LEERNESS_ENABLE_CODEX=0\n' + authored), Buffer.from([0xff])]));rejectUnchanged(f, [...init(f), '--no-env']);
});
test('migrate --no-env leaves the existing example untouched and does not create .env', () => {
  const f = fixture('.env.example', authored), env = path.join(f.dir, '.env');
  fs.writeFileSync(path.join(f.ws, 'HARNESS_VERSION'), '1.36.188\n');
  const before = state(f.file);
  const preview = call(f, ['migrate', f.dir, '--dry-run', '--no-env', '--no-setup-agents']);
  success(preview);assert.match(preview.stdout, /leerness migrate .* --no-env --yes/);
  assert.deepStrictEqual(state(f.file), before);
  success(call(f, ['migrate', f.dir, '--yes', '--no-env', '--no-setup-agents', '--no-mcp', '--no-auto-update', '--no-auto-roadmap', '--no-official-skills', '--no-enforce', '--no-banner']));
  assert.deepStrictEqual(state(f.file), before);
  assert.ok(!fs.existsSync(env), '.env must not be generated');
  assert.ok(fs.existsSync(path.join(f.dir, 'AGENTS.md')), 'the harness must still update');
});
for (const name of targets) test('preserves UTF-8 signature in ' + name, () => {
  const f = fixture(name, '\uFEFF' + authored);success(call(f));assert.ok(text(f.file).startsWith('\uFEFF'));if (!name.endsWith('migration-report.md')) assert.ok(text(f.file).includes(sample));
});
for (const name of targets) test('rejects stale snapshot for ' + name, () => {
  const f = fixture(name);failure(call(f, undefined, { mode: 'after-capture' }));assert.strictEqual(text(f.file), 'competing ' + sample);
});
for (const name of ['.gitignore', '.env', 'README.md']) test('unchanged repeat preserves mtime for ' + name, () => {
  const f = fixture(name);success(call(f));const before = state(f.file);success(call(f));assert.deepStrictEqual(state(f.file), before);
});
test('environment merge keeps existing key values and multilingual comments', () => {
  const f = fixture('.env', '\uFEFFLEERNESS_NPM_TOKEN=fixture-only\r\n' + authored);success(call(f));const result = text(f.file);assert.ok(result.startsWith('\uFEFFLEERNESS_NPM_TOKEN=fixture-only\r\n'));assert.strictEqual(result.split('LEERNESS_NPM_TOKEN=').length, 2);assert.ok(result.includes(sample));
  if (process.platform !== 'win32') assert.strictEqual(fs.statSync(f.file).mode & 0o777, 0o600);
});
test('README synchronization preserves text outside managed section', () => {
  const f = fixture('README.md', authored + '\n<!-- leerness:project-readme:start -->\nold\n<!-- leerness:project-readme:end -->\nAfter ' + sample);success(call(f));assert.ok(text(f.file).includes(authored.trimEnd()));assert.ok(text(f.file).includes('After ' + sample));assert.ok(!text(f.file).includes('\nold\n'));
});
test('migration report still replaces the previous report and names backup actions', () => {
  const f = fixture('.leerness/migration-report.md', 'old report');success(call(f));assert.match(text(f.file), /# Leerness Migration Report[\s\S]*Backup:[\s\S]*File Actions/);assert.ok(!text(f.file).includes('old report'));
});
test('later installer failure reports earlier completed stages without rollback', () => {
  const f = fixture('README.md', Buffer.from([0xff])), r = rejectUnchanged(f, init(f));assert.ok(fs.existsSync(path.join(f.dir, 'AGENTS.md')));assert.ok(text(path.join(f.dir, '.gitignore')).includes('.env'));assert.match(r.stdout + r.stderr, /README.md[\s\S]*not rolled back/);
});
test('README refuses truncated and UTF-16 source data', () => { for (const bytes of [[0xe3, 0x81], [0xff, 0xfe, 0x61, 0]]) rejectUnchanged(fixture('README.md', Buffer.from(bytes))); });
test('oversized line source is refused', () => { rejectUnchanged(fixture('.gitignore', 'a'.repeat(4 * 1024 * 1024 + 1))); });
test('invalid or oversized generated text is refused', () => { for (const mode of ['surrogate', 'oversize']) rejectUnchanged(fixture('README.md'), undefined, { mode }); });
test('hard-linked README is refused without changing its alias', () => { const f = fixture('README.md'), alias = path.join(f.dir, 'alias');fs.linkSync(f.file, alias);const before = state(alias);rejectUnchanged(f);assert.deepStrictEqual(state(alias), before); });
test('fresh installer produces each selected file', () => { const f = fixture('README.md', null);success(call(f, init(f, true)));for (const name of targets) assert.ok(fs.statSync(path.join(f.dir, name)).isFile(), name); });
test('dry-run preserves malformed targets and the entire project tree', () => {
  const tree = dir => fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).map(e => [e.name, e.isDirectory() ? tree(path.join(dir, e.name)) : state(path.join(dir, e.name))]);
  const f = fixture('.env', Buffer.from([0xff]));for (const name of targets.filter(x => x !== '.env')) fs.writeFileSync(path.join(f.dir, name), Buffer.from([0xff]));const before = tree(f.dir);success(call(f, [...init(f, true), '--dry-run']));assert.deepStrictEqual(tree(f.dir), before);
});
test('config rejects malformed UTF-8 without losing source environment values', () => {
  const f = fixture('.leerness/leerness-config.json', Buffer.from([0xff])), env = path.join(f.dir, '.env');fs.writeFileSync(env, 'LEERNESS_OLLAMA_MODEL=' + sample + '\n');const before = state(env);rejectUnchanged(f);assert.deepStrictEqual(state(env), before);
});
test('config rejects invalid JSON without disclosing its contents', () => {
  const privateFixture = 'fixture-confidential-content';const f = fixture('.leerness/leerness-config.json', '{"broken": ' + privateFixture);const r = rejectUnchanged(f);assert.ok(!(r.stdout + r.stderr).includes(privateFixture));
});
test('config refuses non-object JSON instead of discarding existing settings', () => {
  for (const value of ['null', '[]', '"authored"']) rejectUnchanged(fixture('.leerness/leerness-config.json', value));
});
test('config signature and unknown Unicode values survive environment migration', () => {
  const f = fixture('.leerness/leerness-config.json', '\uFEFF' + JSON.stringify({ custom: sample })), env = path.join(f.dir, '.env');fs.writeFileSync(env, '\uFEFF' + authored + 'LEERNESS_OLLAMA_MODEL=' + sample + '\r\nUSER_VALUE=retained\r\n');success(call(f));
  const saved = text(f.file);assert.ok(saved.startsWith('\uFEFF'));const config = JSON.parse(saved.slice(1));assert.strictEqual(config.custom, sample);assert.strictEqual(config.LEERNESS_OLLAMA_MODEL, sample);assert.ok(text(env).startsWith('\uFEFF'));assert.ok(text(env).includes('USER_VALUE=retained'));assert.ok(!text(env).includes('LEERNESS_OLLAMA_MODEL='));
});
test('config copy refusal retains the original nonsecret environment values', () => {
  const f = fixture('.leerness/leerness-config.json', '{}'), env = path.join(f.dir, '.env');fs.writeFileSync(env, 'LEERNESS_OLLAMA_MODEL=' + sample + '\n');const before = state(env);const r = failure(call(f, undefined, { mode: 'copy-failure' }));assert.deepStrictEqual(state(env), before);assert.match(r.stdout + r.stderr, /injected config copy refusal/);
});
function retained(dir, bytes) { return fs.readdirSync(dir, { withFileTypes: true }).some(e => { const p = path.join(dir, e.name);return e.isDirectory() ? retained(p, bytes) : e.isFile() && fs.readFileSync(p).equals(bytes); }); }
test('environment publication conflict reports the already copied configuration', () => {
  const f = fixture('.env', 'LEERNESS_OLLAMA_MODEL=' + sample + '\n'), r = failure(call(f, init(f), { mode: 'publication' }));assert.match(r.stdout + r.stderr, /Nonsecret configuration was saved.*not rolled back/);assert.strictEqual(JSON.parse(text(path.join(f.ws, 'leerness-config.json'))).LEERNESS_OLLAMA_MODEL, sample);assert.ok(retained(f.dir, Buffer.from('competing ' + sample)));
});
for (const name of ['.gitignore', 'README.md', '.leerness/migration-report.md']) test('final publication conflict retains competing content for ' + name, () => {
  const f = fixture(name);failure(call(f, undefined, { mode: 'publication' }));assert.ok(retained(f.dir, Buffer.from('competing ' + sample)));
});
test('new README publication refuses a competing creator', () => { const f = fixture('README.md', null);failure(call(f, undefined, { mode: 'publication' }));assert.ok(retained(f.dir, Buffer.from('competing ' + sample))); });
test('unchanged README still checks for an intervening edit', () => { const f = fixture('README.md');success(call(f));failure(call(f, undefined, { mode: 'after-capture' }));assert.strictEqual(text(f.file), 'competing ' + sample); });
test('fresh authored README discovered before capture is retained', () => { const f = fixture('README.md');success(call(f, undefined, { mode: 'before-capture' }));assert.ok(text(f.file).includes('competing ' + sample)); });
test('JSON install failure reports rejection instead of success', () => { const f = fixture('.env', Buffer.from([0xff])), r = rejectUnchanged(f, [...init(f, true), '--json']);assert.strictEqual(JSON.parse(r.stdout).ok, false); });
test('config detects an intervening edit before replacing settings', () => { const f = fixture('.leerness/leerness-config.json', '{}');failure(call(f, undefined, { mode: 'after-capture' }));assert.strictEqual(text(f.file), 'competing ' + sample); });
test('migration command refuses malformed README bytes and reports partial work', () => {
  const f = fixture('README.md', Buffer.from([0xff])), r = rejectUnchanged(f, ['migrate', f.dir, '--yes', '--no-setup-agents', '--no-auto-roadmap', '--no-mcp', '--no-official-skills']);assert.match(r.stdout + r.stderr, /README.md.*not rolled back/);
});
test('README directory target remains intact on refusal', () => { const f = fixture('README.md', null);fs.mkdirSync(f.file);const child = path.join(f.file, 'keep.txt');fs.writeFileSync(child, sample);const before = state(child);failure(call(f));assert.deepStrictEqual(state(child), before); });
console.log(`Tests: ${passed}/${passed + failed} passed`);process.exitCode = failed ? 1 : 0;
