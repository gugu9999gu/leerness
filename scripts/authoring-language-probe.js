'use strict';
const assert = require('assert'), fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process');
const { createHash } = require('crypto');
const { removeTree } = require('./temp-cleanup');
if (!process.argv.includes('--worker')) {
  const arena = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-authoring-'));
  try {
    const env = { ...process.env, AUTHORING_PROBE_ROOT: arena };
    for (const key of ['HOME', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA', 'TEMP', 'TMP']) { env[key] = path.join(arena, key.toLowerCase());fs.mkdirSync(env[key]); }
    const r = cp.spawnSync(process.execPath, [__filename, '--worker', ...process.argv.slice(2)], { encoding: 'utf8', timeout: 600000, windowsHide: true, env });
    process.stdout.write(r.stdout || '');process.stderr.write(r.stderr || '');if (r.error) process.stderr.write(r.error.message + '\n');
    process.exitCode = r.status === 0 && !r.error ? 0 : 1;
  } finally {
    const resolved = fs.realpathSync(arena);assert.strictEqual(path.dirname(resolved).toLowerCase(), fs.realpathSync(os.tmpdir()).toLowerCase());
    assert.ok(path.basename(resolved).startsWith('leerness-authoring-'));removeTree(resolved, { recursive: true, force: true });
  }
  return;
}
const arena = process.env.AUTHORING_PROBE_ROOT, cli = path.resolve(__dirname, '../bin/leerness.js');
const policy = require('../lib/authoring-language');
const sample = '보존할 원문 日本語 e\u0301 🐝';
let sequence = 0, passed = 0, failed = 0;
const at = process.argv.indexOf('--match'), filter = at < 0 ? '' : process.argv[at + 1];
function test(name, fn) { if (filter && !name.includes(filter)) return;try { fn();passed++;console.log('PASS ' + name); } catch (e) { failed++;console.error('FAIL ' + name + ': ' + e.stack); } }
const text = p => fs.readFileSync(p, 'utf8');
function fixture(manifest = { language: 'ko' }) {
  const dir = path.join(arena, (++sequence) + '-한글 project'), ws = path.join(dir, '.leerness');fs.mkdirSync(ws, { recursive: true });
  const f = { dir, ws, file: name => path.join(ws, name), agents: path.join(dir, 'AGENTS.md') };
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'authoring-test', version: '1.0.0' }));
  fs.writeFileSync(f.file('HARNESS_VERSION'), require('../package.json').version);
  fs.writeFileSync(f.file('LANGUAGE'), manifest.language || 'ko');
  fs.writeFileSync(f.file('manifest.json'), JSON.stringify(manifest));
  return f;
}
function state(p) { const s = fs.statSync(p, { bigint: true });return [createHash('sha256').update(fs.readFileSync(p)).digest('hex'), String(s.mtimeNs)]; }
function tree(dir) { return fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).map(e => [e.name, e.isDirectory() ? tree(path.join(dir, e.name)) : state(path.join(dir, e.name))]); }
function call(f, args, { hook, env = {} } = {}) {
  const r = cp.spawnSync(process.execPath, [...(hook ? ['--require', hook] : []), cli, ...args, '--path', f.dir], {
    cwd: f.dir, encoding: 'utf8', timeout: 90000, windowsHide: true,
    env: { ...process.env, LEERNESS_INTERNAL: '1', LEERNESS_OFFLINE: '1', LEERNESS_NO_AUTOCHCP: '1', LEERNESS_NO_STALE_CHECK: '1', LEERNESS_NO_PATH_CHECK: '1', LEERNESS_LANG: '', ...env } });
  assert.ifError(r.error);return r;
}
function success(r) { assert.strictEqual(r.status, 0, r.stdout + r.stderr);return r; }
function failure(r) { assert.notStrictEqual(r.status, 0, r.stdout + r.stderr);return r; }
const json = r => JSON.parse(success(r).stdout);
const manifest = f => JSON.parse(text(f.file('manifest.json')));
const init = (flags = [], full = false, command = 'init') => [command, '--yes', ...(full ? [] : ['--minimal']), '--no-setup-agents', '--no-mcp', '--no-auto-roadmap', '--no-official-skills', '--no-banner', ...flags];
const enFlags = ['--language', 'ko', '--authoring-language', 'en'];

test('legacy manifests inherit their project language without an extra policy', () => {
  for (const lang of ['ko', 'en']) { const p = policy.readPolicy(fixture({ language: lang }).dir);assert.strictEqual(p.language, lang);assert.strictEqual(p.explicit, false);assert.strictEqual(policy.guidance(p), ''); }
});
test('explicit selection keeps project and authoring languages separate', () => {
  const p = policy.readPolicy(fixture({ language: 'ko', authoringLanguage: 'en' }).dir);
  assert.deepStrictEqual(p, { selection: 'en', language: 'en', projectLanguage: 'ko', explicit: true });
  assert.match(policy.guidance(p), /otherwise Korean/);assert.match(policy.guidance(p), /Preserve quoted source/);
});
test('invalid saved selections are rejected rather than silently inherited', () => {
  for (const value of [null, false, [], {}, 'fr', 'EN', '']) assert.throws(() => policy.readPolicy(fixture({ authoringLanguage: value }).dir), { code: 'E_AUTHORING_LANGUAGE' });
});
test('a caller can reset an invalid choice without discarding other metadata', () => {
  assert.strictEqual(policy.resolvePolicy('ko', { authoringLanguage: [] }, 'inherit').language, 'ko');
});
test('bounded manifest decoding rejects invalid bytes and oversized input', () => {
  for (const bytes of [Buffer.from([0xff]), Buffer.alloc(policy.MAX_MANIFEST_BYTES + 1, 32)]) { const f = fixture();fs.writeFileSync(f.file('manifest.json'), bytes);const before = state(f.file('manifest.json'));assert.throws(() => policy.readPolicy(f.dir));assert.deepStrictEqual(state(f.file('manifest.json')), before); }
});
test('UTF-8 signature and Korean metadata can be read without replacement', () => {
  const f = fixture();fs.writeFileSync(f.file('manifest.json'), '\uFEFF' + JSON.stringify({ language: 'ko', authoringLanguage: 'en', note: sample }));assert.strictEqual(policy.readPolicy(f.dir).language, 'en');
});
test('malformed JSON recovery is explicit and does not hide malformed bytes', () => {
  const f = fixture();fs.writeFileSync(f.file('manifest.json'), '{');assert.throws(() => policy.readPolicy(f.dir));assert.strictEqual(policy.readManifest(f.dir, { recover: true }).corrupt, true);
  fs.writeFileSync(f.file('manifest.json'), Buffer.from([0xff]));assert.throws(() => policy.readManifest(f.dir, { recover: true }));
});
for (const flags of [['--authoring-language'], ['--authoring-language='], ['--authoring-language', 'fr'], ['--authoring-language', 'en', '--authoring-language=ko']]) {
  test('invalid CLI flags are read-only: ' + flags.join(' '), () => { const f = fixture(), before = tree(f.dir);failure(call(f, [...init(flags), '--json']));assert.deepStrictEqual(tree(f.dir), before); });
}
for (const cmd of [['status'], ['migrate', 'audit'], ['migrate', 'apply'], ['migrate', 'plan'], ['update', '--check']]) {
  test('unsupported authoring option cannot silently mutate: ' + cmd.join(' '), () => { const f = fixture(), before = tree(f.dir);failure(call(f, [...cmd, '--authoring-language=en', '--json']));assert.deepStrictEqual(tree(f.dir), before); });
}
test('fresh English authoring keeps Korean project language and reports the choice', () => {
  const f = fixture();success(call(f, init(enFlags, true)));
  assert.strictEqual(manifest(f).language, 'ko');assert.strictEqual(manifest(f).authoringLanguage, 'en');assert.strictEqual(text(f.file('LANGUAGE')).trim(), 'ko');
  assert.match(text(f.agents), /Required behavior/);assert.match(text(f.agents), /otherwise Korean/);
  assert.match(text(f.file('language-policy.md')), /artifacts in English/);
  const s = json(call(f, ['status', '--json']));assert.strictEqual(s.language, 'ko');assert.strictEqual(s.authoringPolicy.language, 'en');
  // Existing template localization is partial; do not assert that every file is English.
  assert.match(text(f.file('language-policy.md')), /not proof.*complete template localization/);
});
test('omitted selection on reinstall retains the choice and unrelated metadata', () => {
  const f = fixture({ language: 'ko', authoringLanguage: 'en', mode: 'minimal', installedAt: '2026-01-01', custom: { note: sample } });
  success(call(f, init()));const m = manifest(f);assert.strictEqual(m.authoringLanguage, 'en');assert.strictEqual(m.mode, 'minimal');assert.strictEqual(m.installedAt, '2026-01-01');assert.strictEqual(m.custom.note, sample);
  assert.match(text(f.agents), /minimal mode/);assert.match(text(f.agents), /artifacts in English/);
});
test('existing Korean projects are never switched by an ordinary reinstall', () => {
  const f = fixture();success(call(f, init()));assert.ok(!Object.hasOwn(manifest(f), 'authoringLanguage'));assert.match(text(f.agents), /매 세션 첫 행동/);
});
test('ordinary fresh installation works before a workspace directory exists', () => {
  const dir = path.join(arena, (++sequence) + '-empty-project');fs.mkdirSync(dir);const f = { dir };
  success(call(f, init(enFlags)));const m = JSON.parse(text(path.join(dir, '.leerness/manifest.json')));assert.strictEqual(m.authoringLanguage, 'en');assert.strictEqual(m.language, 'ko');
});
test('unreadable manifest bytes stop installation before generated documents', () => {
  const f = fixture();fs.writeFileSync(f.file('manifest.json'), Buffer.from([0xff]));const before = state(f.file('manifest.json'));
  failure(call(f, init(enFlags)));assert.deepStrictEqual(state(f.file('manifest.json')), before);assert.ok(!fs.existsSync(f.agents));
});
test('explicit reset repairs a bad saved selection through the real CLI', () => {
  const f = fixture({ language: 'ko', authoringLanguage: false, custom: sample });
  failure(call(f, init()));assert.ok(!fs.existsSync(f.agents));success(call(f, init(['--authoring-language', 'inherit'])));
  assert.ok(!Object.hasOwn(manifest(f), 'authoringLanguage'));assert.strictEqual(manifest(f).custom, sample);
});
test('installer keeps its explicit malformed-JSON recovery warning', () => {
  const f = fixture();fs.writeFileSync(f.file('manifest.json'), '{');const r = success(call(f, init(enFlags)));
  assert.match(r.stdout, /manifest.json.*invalid_json/);assert.strictEqual(manifest(f).authoringLanguage, 'en');
});
test('switch and reset remove obsolete policy while preserving user text and state', () => {
  const f = fixture();success(call(f, init(enFlags)));
  fs.appendFileSync(f.agents, '\nCUSTOM ' + sample + '\n');fs.writeFileSync(f.file('plan.md'), '\uFEFF' + sample + '\r\n');const before = state(f.file('plan.md'));
  success(call(f, init(['--authoring-language', 'ko'])));assert.match(text(f.agents), /artifacts in Korean/);assert.ok(!text(f.agents).includes('artifacts in English'));assert.ok(text(f.agents).includes(sample));
  success(call(f, init(['--authoring-language', 'inherit'])));assert.ok(!Object.hasOwn(manifest(f), 'authoringLanguage'));assert.ok(!text(f.agents).includes('## Harness authoring language'));assert.strictEqual(text(f.agents).split(sample).length, 2);assert.deepStrictEqual(state(f.file('plan.md')), before);
});
test('migrate retains explicit choice when only user language changes', () => {
  const f = fixture({ language: 'ko', authoringLanguage: 'en' });success(call(f, init(['--language', 'en'], false, 'migrate')));
  assert.strictEqual(manifest(f).authoringLanguage, 'en');assert.strictEqual(manifest(f).language, 'en');assert.match(text(f.agents), /otherwise English/);
});
test('reset from English authoring to inherited English removes the override alone', () => {
  const f = fixture({ language: 'en', authoringLanguage: 'en' });success(call(f, init()));
  success(call(f, init(['--authoring-language=inherit'])));assert.ok(!Object.hasOwn(manifest(f), 'authoringLanguage'));
  assert.match(text(f.agents), /Required behavior/);assert.ok(!text(f.agents).includes('## Harness authoring language'));
});
test('minimal project adapter and mode changes retain saved English authoring', () => {
  const f = fixture({ language: 'ko', authoringLanguage: 'en', mode: 'minimal' });
  success(call(f, ['adapter', 'codex', '--json']));assert.match(text(f.agents), /minimal mode/);assert.match(text(f.agents), /artifacts in English/);
  success(call(f, ['mode', 'set', 'standard', '--json']));assert.match(text(f.agents), /Required behavior/);assert.match(text(f.agents), /otherwise Korean/);assert.strictEqual(manifest(f).authoringLanguage, 'en');
});
test('authoring dry-run preserves the whole existing project tree', () => {
  const f = fixture();const before = tree(f.dir);success(call(f, init([...enFlags, '--dry-run'])));assert.deepStrictEqual(tree(f.dir), before);
});
test('a fresh dry-run does not create its target directory', () => {
  const f = { dir: path.join(arena, 'missing-project') };
  const r = cp.spawnSync(process.execPath, [cli, ...init([...enFlags, '--dry-run']), '--path', f.dir], { cwd: arena, encoding: 'utf8', timeout: 90000, windowsHide: true, env: { ...process.env, LEERNESS_INTERNAL: '1', LEERNESS_OFFLINE: '1', LEERNESS_NO_STALE_CHECK: '1' } });
  assert.ifError(r.error);success(r);assert.ok(!fs.existsSync(f.dir));
});
test('status and handoff expose the same explicit selection in JSON and compact text', () => {
  const f = fixture({ language: 'ko', authoringLanguage: 'en' });
  const s = json(call(f, ['status', '--json'])), h = json(call(f, ['handoff', '--json']));assert.deepStrictEqual(s.authoringPolicy, h.authoringPolicy);
  assert.match(success(call(f, ['handoff', '--compact'])).stdout, /artifacts in English/);
});
test('session close uses English placeholders but retains Korean source evidence', () => {
  const f = fixture({ language: 'ko', authoringLanguage: 'en' });
  fs.writeFileSync(f.file('progress-tracker.md'), '# Progress\n');fs.writeFileSync(f.file('review-evidence.md'), sample);
  fs.writeFileSync(f.file('current-state.md'), '# State\n## Now\n## Next\n## Blockers\n');
  const r = json(call(f, ['session', 'close', '--json', '--no-record', '--no-suggest']));assert.strictEqual(r.authoringPolicy.projectLanguage, 'ko');
  const h = text(f.file('session-handoff.md'));assert.ok(h.includes(sample));assert.match(h, /Agree the next priority/);assert.match(text(f.file('current-state.md')), /no planned tasks/);assert.ok(!h.includes('없음'));
});
// Exercise the CLI's actual injected brief without probing or invoking a model.
const hook = path.join(arena, 'capture-brief.cjs');
fs.writeFileSync(hook, `const agents=require(${JSON.stringify(path.resolve(__dirname, '../lib/agents'))});agents.agentsCmd=(root,sub,args,deps)=>{console.log(JSON.stringify({brief:deps.has('--raw')?'':(deps._harnessBrief?deps._harnessBrief():''),task:args[0]}));};`);
test('delegation receives policy from the target project without changing the task', () => {
  const f = fixture({ language: 'ko', authoringLanguage: 'en' });const r = json(call(f, ['agents', 'dispatch', sample, '--to', 'codex', '--json'], { hook }));
  assert.strictEqual(r.task, sample);assert.match(r.brief, /artifacts in English/);assert.match(r.brief, /otherwise Korean/);assert.ok(!/[\r\n`$"\u201c\u201d]/u.test(r.brief));
});
test('raw and delegation-brief toggle still opt out of injected guidance', () => {
  const f = fixture({ language: 'ko', authoringLanguage: 'en' });
  assert.strictEqual(json(call(f, ['agents', 'dispatch', sample, '--raw', '--json'], { hook })).brief, '');
  success(call(f, ['toggle', 'set', 'delegation-brief', 'off', '--json']));assert.strictEqual(json(call(f, ['agents', 'dispatch', sample, '--json'], { hook })).brief, '');
});
test('legacy delegation without a selection has no extra authoring guidance', () => {
  const f = fixture();const r = json(call(f, ['agents', 'dispatch', sample, '--json'], { hook }));assert.ok(!r.brief.includes('artifacts in'));assert.match(r.brief, /assigned task/);
});
console.log(`Tests: ${passed}/${passed + failed} passed`);process.exitCode = failed ? 1 : 0;
