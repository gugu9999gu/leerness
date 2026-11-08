'use strict';
require('./temp-cleanup').trackTemp(module);
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
const Module = require('node:module');
const vm = require('node:vm');
const { createHash } = require('node:crypto');
const source = path.resolve(process.env.LEERNESS_READ_TEST_SOURCE || path.join(__dirname, '..'));
const cli = path.join(source, 'bin/leerness.js'), content = fs.readFileSync(cli, 'utf8');
const compiled = new Module(cli, module);
compiled.filename = cli; compiled.paths = Module._nodeModulePaths(path.dirname(cli));
compiled._compile(content + '\nmodule.exports.readProbe={_assertStoreParsable,_readPermissions,_readCredentials,_loadPlatformConstraintsChecked,_loadPlatformConstraints,_readUserProviders,_mergeMcpJson,_guardStore};', cli);
const api = compiled.exports.readProbe, version = require(path.join(source, 'package.json')).version;
const arena = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 't0344-'));
let sequence = 0;
function fixture(file, bytes) {
  const root = path.join(arena, 'p' + sequence++), ws = path.join(root, '.leerness');
  fs.mkdirSync(ws, { recursive: true });
  const put = (name, value) => fs.writeFileSync(path.join(ws, name), value);
  put('HARNESS_VERSION', version + '\n'); put('LANGUAGE', 'en\n');
  put('progress-tracker.md', '# Tasks\n| ID | Status | Request | Evidence | Next Action | Updated |\n|---|---|---|---|---|---|\n| T-0001 | in-progress | Keep authored request | evidence | next | 2026-11-05 |\n');
  put('plan.md', '# Plan\n<!-- leerness:owner-priorities:start -->\n1. T-0001\n<!-- leerness:owner-priorities:end -->\n');
  put('rules.md', '# Rules\n'); put('current-state.md', '# State\nUnknown remains unknown.\n');
  const target = file.startsWith('.') ? path.join(root, file) : path.join(ws, file);
  if (bytes !== undefined) fs.writeFileSync(target, bytes);
  return { root, ws, target };
}
function snapshot(root) {
  const rows = [];
  function walk(dir) { for (const name of fs.readdirSync(dir).sort()) {
    const file = path.join(dir, name), st = fs.lstatSync(file, { bigint: true });
    rows.push([path.relative(root, file), String(st.ino), String(st.mode), String(st.mtimeNs),
      st.isSymbolicLink() ? fs.readlinkSync(file) : st.isFile() ? createHash('sha256').update(fs.readFileSync(file)).digest('hex') : null]);
    if (st.isDirectory()) walk(file);
  } }
  walk(root); return rows;
}
function gap(f) {
  const dir = fs.mkdtempSync(path.join(path.dirname(f.target), '.' + path.basename(f.target) + '.publish-cas-'));
  fs.writeFileSync(path.join(dir, 'next'), 'replacement');
  fs.renameSync(f.target, path.join(dir, 'before'));
}
const readers = [
  ['generic', 'sample.json', f => api._assertStoreParsable(f.target, 'sample')],
  ['permissions', 'agent-permissions.json', f => api._readPermissions(f.root)],
  ['credentials', 'credentials.local.json', f => api._readCredentials(f.root)],
  ['constraints checked', 'platform-constraints.json', f => api._loadPlatformConstraintsChecked(f.root)],
  ['constraints fallback', 'platform-constraints.json', f => api._loadPlatformConstraints(f.root)],
  ['MCP', '.mcp.json', f => api._mergeMcpJson(f.root)],
];
for (const [label, file, read] of readers) {
  test(label + ': unfinished publication is refused without changing evidence', () => {
    const f = fixture(file, '{}'); gap(f); const before = snapshot(f.root);
    assert.throws(() => read(f), { code: 'E_STORE_CHANGED' }); assert.deepEqual(snapshot(f.root), before);
  });
  test(label + ': hardlink source is refused', () => {
    const f = fixture(file, '{}'); fs.linkSync(f.target, f.target + '.other'); const before = snapshot(f.root);
    assert.throws(() => read(f), { code: 'E_STORE_INVALID' }); assert.deepEqual(snapshot(f.root), before);
  });
  test(label + ': operational read failure is not an empty/default state', () => {
    const f = fixture(file, '{}'), original = fs.openSync; let reached = false;
    fs.openSync = function(file, ...args) { if (path.resolve(String(file)) === f.target) { reached = true; throw Object.assign(new Error('injected EACCES'), { code: 'EACCES' }); } return original.call(this, file, ...args); };
    try { assert.throws(() => read(f), { code: 'E_STORE_UNREADABLE' }); } finally { fs.openSync = original; }
    assert(reached);
  });
}
for (const [label, file, read] of readers.filter(row => !row[0].startsWith('constraints'))) {
  for (const [kind, bytes] of [['JSON', '{"private":"do-not-echo",'], ['UTF8', Buffer.from([123, 255, 125])]]) {
    test(label + ': invalid ' + kind + ' is refused and preserved', () => {
      const f = fixture(file, bytes), before = snapshot(f.root);
      assert.throws(() => read(f), error => error.code === 'E_STORE_CORRUPT' && !error.message.includes('do-not-echo'));
      assert.deepEqual(snapshot(f.root), before);
    });
  }
}
test('genuine missing readers keep their established defaults without writing', () => {
  const f = fixture('missing.json'), before = snapshot(f.root);
  assert.equal(api._assertStoreParsable(f.target, 'missing'), undefined);
  assert.equal(api._readPermissions(f.root).mode, 'basic'); assert.deepEqual(api._readCredentials(f.root), { schemaVersion: 1, services: {} });
  assert.equal(api._loadPlatformConstraintsChecked(f.root).corrupt, false); assert.deepEqual(snapshot(f.root), before);
});
test('generic reader accepts BOM/CRLF and preserves exact original bytes', () => {
  const f = fixture('sample.json', '\ufeff{\r\n "extension": "한글"\r\n}\r\n'), before = snapshot(f.root);
  assert.deepEqual(api._assertStoreParsable(f.target, 'sample'), { extension: '한글' }); assert.deepEqual(snapshot(f.root), before);
});
test('constraints retain the explicit corrupt-store diagnostic for malformed JSON', () => {
  const f = fixture('platform-constraints.json', '{'), before = snapshot(f.root);
  assert.equal(api._loadPlatformConstraintsChecked(f.root).corrupt, true); assert.deepEqual(snapshot(f.root), before);
});
test('generic reader refuses directory and oversized input before parsing', () => {
  const f = fixture('sample.json'); fs.mkdirSync(f.target);
  assert.throws(() => api._assertStoreParsable(f.target, 'sample'), { code: 'E_STORE_INVALID' });
  fs.rmdirSync(f.target); fs.writeFileSync(f.target, ' '.repeat(4 * 1024 * 1024 + 1));
  assert.throws(() => api._assertStoreParsable(f.target, 'sample'), { code: 'E_STORE_INVALID' });
});
function run(f, args) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (/^(?:LEERNESS_|_LEERNESS_|GIT_|NODE_OPTIONS$)/i.test(key)) delete env[key];
  Object.assign(env, { LEERNESS_OFFLINE: '1', LEERNESS_INTERNAL: '1', LEERNESS_NO_PROMPT: '1', LEERNESS_NO_BANNER: '1', LEERNESS_NO_STALE_CHECK: '1', LEERNESS_NO_AUTOCHCP: '1', NO_COLOR: '1' });
  const result = cp.spawnSync(process.execPath, [cli, ...args, '--path', f.root], { cwd: f.root, env, encoding: 'utf8', windowsHide: true, timeout: 30000, maxBuffer: 4 * 1024 * 1024 });
  assert.equal(result.error, undefined); assert.equal(result.signal, null); return result;
}
for (const [file, bytes, code] of [['auto-resume-plan.json', '{', 'store_corrupt'], ['auto-resume-plan.json', 'null', 'store_invalid'], ['auto-resume-plan.json', '{"savedAt":"2026-11-05T00:00:00Z"}', 'store_changed'], ['plan.md', '# Plan', 'store_changed'], ['progress-tracker.md', '# Tasks', 'store_changed']]) {
  test('inspected handoff refuses ' + file + '/' + code + ' before writing', () => {
    const f = fixture(file, bytes); if (code === 'store_changed') gap(f); const before = snapshot(f.root);
    const result = run(f, ['handoff', '--inspect', '--json', '--no-record']);
    assert.equal(result.status, 1, result.stdout + result.stderr); assert.equal(JSON.parse(result.stdout).code, code); assert.deepEqual(snapshot(f.root), before);
  });
}
test('inspected handoff succeeds with a genuinely absent resume plan', () => {
  const f = fixture('absent.json'), before = snapshot(f.root), result = run(f, ['handoff', '--inspect', '--json', '--no-record']);
  assert.equal(result.status, 0, result.stdout + result.stderr); assert.equal(JSON.parse(result.stdout).nextTask.id, 'T-0001', result.stdout); assert.deepEqual(snapshot(f.root), before);
});
function cycle(f, provider = 'claude') {
  const start = content.indexOf('      const getProviders = () => {'), end = content.indexOf('      const cycleModel =', start);
  assert(start >= 0 && end > start);
  const state = { provider, model: 'keep-model' }, errors = [], output = [], defaults = ['claude', 'codex'];
  const sandbox = { fs, path, root: f.root, absRoot: path.resolve, _PROVIDER_CYCLE_ORDER: defaults, _readUserProviders: api._readUserProviders,
    _guardStore: (json, fn) => { try { return fn(); } catch (error) { errors.push(error.code); } },
    state, isTty: true, _lastCycleLines: 0, _PROVIDER_MODEL_CATALOG: {}, EXTERNAL_AGENTS: [],
    process: { stdout: { write: s => output.push(s) } }, C: { bold: s => s, green: s => s, yel: s => s, dim: s => s }, rl: { setPrompt() {}, prompt() {} }, prompt: () => '> ' };
  vm.runInNewContext(content.slice(start, end) + '\ncycleProvider(false);', sandbox, { timeout: 15000 });
  return { state, errors, output };
}
for (const [label, bytes, code] of [['gap', '{"providers":[]}', 'E_STORE_CHANGED'], ['corrupt', '{', 'E_STORE_CORRUPT'], ['invalid', '{"providers":null}', 'E_STORE_INVALID']]) {
  test('TTY provider closure reports ' + label + ' and retains provider/model', () => {
    const f = fixture('providers.json', bytes); if (label === 'gap') gap(f); const before = snapshot(f.root), result = cycle(f);
    assert.deepEqual(result.errors, [code]); assert.deepEqual(result.state, { provider: 'claude', model: 'keep-model' }); assert.deepEqual(snapshot(f.root), before);
  });
}
for (const bytes of [undefined, '\ufeff{"providers":[{"id":"custom"}]}\r\n']) {
  test('TTY provider closure retains valid/default cycling', () => {
    const f = fixture('providers.json', bytes), before = snapshot(f.root), result = cycle(f);
    assert.deepEqual(result.errors, []); assert.equal(result.state.provider, 'codex'); assert.equal(result.state.model, null); assert.deepEqual(snapshot(f.root), before);
  });
}
test('TTY provider closure includes the custom provider from BOM input', () => {
  const f = fixture('providers.json', '\ufeff{"providers":[{"id":"custom"}]}\r\n');
  const result = cycle(f, 'codex'); assert.deepEqual(result.errors, []); assert.equal(result.state.provider, 'custom');
});
for (const [file, args] of [
  ['credentials.local.json', ['creds', 'list']],
  ['agent-permissions.json', ['permissions', 'list']],
  ['platform-constraints.json', ['constraints', 'list']],
  ['manifest.json', ['adapter', 'codex', '--dry-run']],
]) {
  test('CLI ' + args.join(' ') + ' refuses publication gap without fallback or writes', () => {
    const f = fixture(file, '{}'); gap(f); const before = snapshot(f.root), result = run(f, [...args, '--json']);
    assert.equal(result.status, 1, result.stdout + result.stderr); assert.equal(JSON.parse(result.stdout).code, 'store_changed');
    assert.deepEqual(snapshot(f.root), before);
  });
}
test('generic source replacement during read is refused', () => {
  const f = fixture('sample.json', '{"original":true}'), original = fs.openSync; let reached = false;
  fs.openSync = function(file, ...args) {
    if (!reached && path.resolve(String(file)) === f.target) { reached = true; fs.renameSync(f.target, f.target + '.before'); fs.writeFileSync(f.target, '{"changed":true}'); }
    return original.call(this, file, ...args);
  };
  try { assert.throws(() => api._assertStoreParsable(f.target, 'sample'), { code: 'E_STORE_CHANGED' }); }
  finally { fs.openSync = original; }
  assert(reached); assert.equal(fs.readFileSync(f.target, 'utf8'), '{"changed":true}'); assert.equal(fs.readFileSync(f.target + '.before', 'utf8'), '{"original":true}');
});
test('generic reader preserves genuine missing-parent compatibility', () => {
  const f = fixture('absent.json'), file = path.join(f.root, 'not-created', 'sample.json'), before = snapshot(f.root);
  assert.equal(api._assertStoreParsable(file, 'missing'), undefined); assert.deepEqual(snapshot(f.root), before);
});
