'use strict';
require('./temp-cleanup').trackTemp(module);
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const cp = require('node:child_process');
const { createHash } = require('node:crypto');
const { removeSync } = require('../lib/safe-remove');
const { taskList } = require('../lib/task-list-read');
const { stateShow } = require('../lib/state-show-read');
const { createSnapshot } = require('../lib/stored-read-snapshot');
const errorLanguage = require('../lib/error-language');
const CLI = path.resolve(__dirname, '../bin/leerness.js');
const VERSION = require('../package.json').version;
const sha = b => createHash('sha256').update(b).digest('hex');
const row = (id, status, request = '한글 🐝 e\u0301 | 원문') => `| ${id} | ${status} | ${request.replaceAll('|', '\\|')} | original evidence | next ${id} | 2026-10-30 |\r\n`;
function baseEnv() {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (/^(?:LEERNESS_|_LEERNESS_|GIT_|CLAUDE|CODEX|CURSOR|CI$|GITHUB_ACTIONS$)/i.test(key)) delete env[key];
  Object.assign(env, { LEERNESS_NO_BANNER: '1', LEERNESS_NO_PROMPT: '1', LEERNESS_NO_STALE_CHECK: '1', LEERNESS_NO_AUTO_WORKSPACE_MIGRATION: '1', NO_COLOR: '1' });
  return env;
}
function fixture(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-stored-read-é-한글-'));
  fs.mkdirSync(path.join(root, '.leerness'));
  const put = (file, data) => { const p = path.join(root, '.leerness', file); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, typeof data === 'string' || Buffer.isBuffer(data) ? data : JSON.stringify(data, null, 2) + '\n'); };
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'stored-reader-fixture' }));
  put('HARNESS_VERSION', VERSION + '\n'); put('manifest.json', { language: 'ko', mode: 'standard' });
  put('plan.md', '<!-- leerness:owner-priorities:start -->\n1. T-0001\n<!-- leerness:owner-priorities:end -->\n');
  put('progress-tracker.md', '\ufeff---\r\nleernessRole: progress-tracker\r\n---\r\n<!-- leerness:managed -->\r\n# Tasks\r\n\r\n| ID | Status | Request | Evidence | Next Action | Updated |\r\n|---|---|---|---|---|---|\r\n' + row('T-0001', 'in-progress') + row('T-0002', 'done') + row('T-0003', 'blocked') + '\r\nAuthored footer.\r\n');
  put('rules.md', '# Rules\n'); put('session-handoff.md', '<!-- leerness:current-handoff:start -->\n# Current\nNext T-0001\n<!-- leerness:current-handoff:end -->\n');
  put('current-state.md', '# State\nUnverified remains unknown.\n'); put('decisions.json', []); put('lessons.json', []);
  const env = baseEnv();
  const run = (args, options = {}) => cp.spawnSync(process.execPath, [CLI, ...args, '--path', root], { cwd: root, env, encoding: 'utf8', timeout: 30000, maxBuffer: 8 * 1024 * 1024, ...options });
  const rpc = (calls, options = {}) => {
    const requests = calls.map(([name, args], i) => ({ jsonrpc: '2.0', id: i + 1, method: 'tools/call', params: { name, arguments: { path: root, ...args } } }));
    const result = run(['mcp', 'serve', '--profile', 'full'], { ...options, input: requests.map(r => JSON.stringify(r)).join('\n') + '\n' });
    assert.equal(result.status, 0, result.stderr + result.stdout);
    const messages = result.stdout.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
    assert.equal(messages.length, requests.length, result.stdout);
    return messages;
  };
  try { return fn({ root, put, env, run, rpc }); }
  finally { removeSync(root, { recursive: true, force: true }); }
}
function bytes(root) {
  const out = {};
  const walk = dir => { for (const name of fs.readdirSync(dir)) { const file = path.join(dir, name), stat = fs.lstatSync(file, { bigint: true });
    if (stat.isDirectory()) walk(file); else out[path.relative(root, file)] = [stat.isSymbolicLink() ? fs.readlinkSync(file) : sha(fs.readFileSync(file)), String(stat.mtimeNs)];
  } }; walk(root); return out;
}
function parsed(message) { assert.equal(message.result?.isError, false, JSON.stringify(message)); return JSON.parse(message.result.content[0].text); }
function runs(f) {
  const run = id => ({ run_id: id, status: 'started', goal: id, agent_name: 'fixture', model_name: null,
    files_changed: [], commands_run: [], tests_run: [], decisions: [], verification_result: 'not_run' });
  f.put('runs/run-0001.json', run('run-0001')); f.put('runs/run-0002.json', run('run-0002'));
  f.put('state.json', { schemaVersion: 1, project: 'fixture', currentRunId: 'run-0002', runCounter: 2, updatedAt: null,
    runsBySession: { 'alpha-session-0001': 'run-0001', 'bravo-session-0002': 'run-0002' } });
}
test('task JSON and text retain filters, tail limits and exact authored values', () => fixture(f => {
  const before = bytes(f.root);
  const limited = taskList(f.root, { json: true, limit: 1 });
  assert.equal(limited.data.total, 3); assert.equal(limited.data.shown, 1); assert.equal(limited.data.truncated, true);
  assert.equal(limited.data.tasks[0].id, 'T-0003'); assert.equal(limited.data.tasks[0].request, '한글 🐝 e\u0301 | 원문');
  assert.equal(taskList(f.root, { all: true, limit: 1 }).data.shown, 3);
  assert.equal(taskList(f.root, { status: 'done' }).data.tasks[0].id, 'T-0002');
  assert.equal(taskList(f.root, { status: 'waiting' }).data.total, 0);
  assert.equal(taskList(f.root, { limit: 'invalid' }).data.shown, 3);
  assert.match(taskList(f.root, { json: false, limit: 1 }).text, /T-0001/);
  assert.match(taskList(f.root, { json: false }).text, /\\\| 원문/);
  assert.deepEqual(bytes(f.root), before);
}));
test('CLI and direct MCP preserve task list payload and character pagination', () => fixture(f => {
  const expected = f.run(['task', 'list', '--json', '--limit', '2']); assert.equal(expected.status, 0, expected.stderr);
  const messages = f.rpc([['leerness_task_list', { limit: 2 }], ['leerness_task_list', { limit: 2, _chunkSize: 73 }], ['leerness_task_list', { limit: 2, _chunkSize: 73, _cursor: '73' }]]);
  assert.equal(messages[0].result.content[0].text, expected.stdout);
  assert.equal(messages[1].result.content[0].text, expected.stdout.slice(0, 73));
  assert.equal(messages[1].result.nextCursor, '73');
  assert.equal(messages[1].result._truncated.totalLength, expected.stdout.length);
  assert.equal(messages[2].result.content[0].text, expected.stdout.slice(73, 146));
}));
test('retained task listing observes selected source and refuses stale history', () => fixture(f => {
  const W = require('../lib/history-retention-write');
  const preview = W.preview(f.root, { tasks: ['T-0002'] }); W.apply(f.root, { tasks: ['T-0002'], expected: preview.expected });
  const before = bytes(f.root), result = taskList(f.root, { all: true });
  assert.equal(result.data.total, 3); assert.equal(result.data.tasks[0].id, 'T-0002'); assert.equal(result.data.tasks[0].retained, true);
  assert.deepEqual(bytes(f.root), before);
  fs.appendFileSync(path.join(f.root, '.leerness/archive/history/index.json'), '\n');
  assert.throws(() => result.snapshot.verify(), { code: 'E_STORE_CHANGED' });
}));
test('shared state chooses the caller run and redacts other session addresses', () => fixture(f => {
  runs(f); const before = bytes(f.root);
  const alpha = stateShow(f.root, { env: { LEERNESS_SESSION_ID: 'alpha-session-0001' } }).data;
  assert.equal(alpha.resolvedRunId, 'run-0001'); assert.equal(alpha.currentRun.run_id, 'run-0001');
  assert(alpha.runsBySession['alpha-session-0001']); assert(!JSON.stringify(alpha).includes('bravo-session-0002'));
  const anonymous = stateShow(f.root, { env: {} }).data;
  assert.equal(anonymous.currentRun, null); assert.equal(anonymous.resolvedRunId, null);
  assert(!JSON.stringify(anonymous).includes('alpha-session-0001'));
  assert.deepEqual(bytes(f.root), before);
}));
test('direct MCP session address is per request, not ambient or sticky', () => fixture(f => {
  runs(f); const before = bytes(f.root);
  const values = f.rpc([['leerness_state_show', { sessionKey: 'alpha-session-0001' }], ['leerness_state_show', { sessionKey: 'bravo-session-0002' }], ['leerness_state_show', {}], ['leerness_state_show', { sessionKey: 'alpha-session-0001' }]]).map(parsed);
  assert.deepEqual(values.map(v => v.resolvedRunId), ['run-0001', 'run-0002', null, 'run-0001']);
  const cli = f.run(['state', 'show', '--json'], { env: { ...f.env, LEERNESS_SESSION_ID: 'alpha-session-0001', LEERNESS_SESSION_IDENTITY_SOURCE: 'mcp-connection', LEERNESS_INTERNAL: '1' } });
  assert.equal(cli.status, 0); assert.deepEqual(JSON.parse(cli.stdout), values[0]); assert.deepEqual(values[0], values[3]);
  assert.deepEqual(bytes(f.root), before);
}));
test('corrupt state and malformed owner priority preserve CLI/MCP error formatting', () => fixture(f => {
  f.put('state.json', '{ malformed');
  const cli = f.run(['state', 'show', '--json']); assert.equal(cli.status, 1);
  const result = f.rpc([['leerness_state_show', {}]])[0].result;
  assert.equal(result.isError, true); assert.equal(result.content[0].text, cli.stdout);
  assert.equal(JSON.parse(cli.stdout).code, 'store_corrupt');
  f.put('plan.md', '<!-- leerness:owner-priorities:start -->\n1. T-0001\n');
  const hc = f.run(['handoff', '--compact']); assert.equal(hc.status, 1);
  const hm = f.rpc([['leerness_handoff', {}]])[0].result;
  assert.equal(hm.isError, true); assert.equal(hm.content[0].text, hc.stdout);
}));
test('existing invalid state shape with no runs retains the legacy initial-state behavior', () => fixture(f => {
  f.put('state.json', {}); const initial = stateShow(f.root, { env: {} }).data;
  assert.equal(initial.state.runCounter, 0); assert.equal(initial.resolvedRunId, null);
  runs(f); f.put('state.json', {});
  assert.throws(() => stateShow(f.root, { env: {} }), { code: 'E_STORE_CORRUPT' });
}));
test('run mismatch and run counter regression are rejected without overwriting originals', () => fixture(f => {
  runs(f); const before = bytes(f.root);
  f.put('runs/run-0001.json', { run_id: 'run-0002' });
  assert.throws(() => stateShow(f.root, { env: { LEERNESS_SESSION_ID: 'alpha-session-0001' } }), { code: 'E_STORE_CORRUPT' });
  f.put('state.json', { currentRunId: null, runCounter: 0 });
  assert.throws(() => stateShow(f.root, { env: {} }), { code: 'E_STORE_CORRUPT' });
  assert.equal(bytes(f.root)['runs/run-0002.json']?.[0], before['runs/run-0002.json']?.[0]);
}));
test('task and run-directory changes invalidate captured selected-input snapshots', () => fixture(f => {
  const result = taskList(f.root); f.put('progress-tracker.md', row('T-0001', 'done'));
  assert.throws(() => result.snapshot.verify(), { code: 'E_STORE_CHANGED' });
  runs(f); const selected = stateShow(f.root, { env: { LEERNESS_SESSION_ID: 'alpha-session-0001' } });
  f.put('runs/run-0003.json', { run_id: 'run-0003' });
  assert.throws(() => selected.snapshot.verify(), { code: 'E_STORE_CHANGED' });
}));
test('missing parent appearance and directory replacement invalidate a snapshot', () => fixture(f => {
  const snapshot = createSnapshot(f.root); assert.equal(snapshot.exists(path.join(f.root, '.leerness/absent/file.md')), false);
  f.put('absent/file.md', 'new source'); assert.throws(() => snapshot.verify(), { code: 'E_STORE_CHANGED' });
  const other = createSnapshot(f.root); other.read(path.join(f.root, '.leerness/absent/file.md'));
  fs.renameSync(path.join(f.root, '.leerness/absent'), path.join(f.root, '.leerness/renamed'));
  fs.mkdirSync(path.join(f.root, '.leerness/absent')); f.put('absent/file.md', 'new source');
  assert.throws(() => other.verify(), { code: 'E_STORE_CHANGED' });
}));
test('hard-linked tracker is rejected before emitting a success response', () => fixture(f => {
  fs.linkSync(path.join(f.root, '.leerness/progress-tracker.md'), path.join(f.root, 'extra-link'));
  assert.throws(() => taskList(f.root), { code: 'E_STORE_INVALID' });
  const cli = f.run(['task', 'list', '--json']); assert.equal(cli.status, 1); assert.equal(JSON.parse(cli.stdout).ok, false);
  const remote = f.rpc([['leerness_task_list', {}]])[0].result;
  assert.equal(remote.isError, true); assert.equal(remote.content[0].text, cli.stdout);
}));
test('library reads leave argv, environment, and stdout writer unchanged', () => fixture(f => {
  const argv = process.argv, env = { ...process.env }, writer = process.stdout.write;
  taskList(f.root); stateShow(f.root, { env: { LEERNESS_SESSION_ID: 'test-session-0001' } });
  assert.equal(process.argv, argv); assert.deepEqual({ ...process.env }, env); assert.equal(process.stdout.write, writer);
}));
test('request-local error language restores parent scope after success and failure', async () => {
  errorLanguage.setErrorLanguage(() => 'ko');
  const results = await Promise.all(['en', 'ko'].map(lang => errorLanguage.withErrorLanguage(lang, async () => {
    await new Promise(resolve => setImmediate(resolve)); return errorLanguage.errorLanguage();
  })));
  assert.deepEqual(results, ['en', 'ko']); assert.equal(errorLanguage.errorLanguage(), 'ko');
  assert.throws(() => errorLanguage.withErrorLanguage('en', () => { assert.equal(errorLanguage.errorLanguage(), 'en'); throw new Error('test'); }));
  assert.equal(errorLanguage.errorLanguage(), 'ko'); errorLanguage.setErrorLanguage(null);
});
test('MCP checked-file errors use target project language and do not leak between requests', () => fixture(f => {
  const second = path.join(f.root, 'english'); fs.mkdirSync(path.join(second, '.leerness'), { recursive: true });
  fs.writeFileSync(path.join(second, '.leerness/manifest.json'), JSON.stringify({ language: 'EN' }));
  fs.writeFileSync(path.join(second, '.leerness/progress-tracker.md'), row('T-0001', 'done'));
  fs.linkSync(path.join(second, '.leerness/progress-tracker.md'), path.join(second, 'extra-link'));
  fs.linkSync(path.join(f.root, '.leerness/progress-tracker.md'), path.join(f.root, 'extra-link'));
  const messages = f.rpc([['leerness_task_list', { path: second }], ['leerness_task_list', {}]]);
  assert.match(messages[0].result.content[0].text, /Memory input/);
  assert.match(messages[1].result.content[0].text, /일반 파일/);
}));
test('handoff defaults share JSON, compact and plain format contracts without recording', () => fixture(f => {
  const before = bytes(f.root);
  for (const args of [['handoff'], ['handoff', '--compact'], ['handoff', '--json']]) {
    const result = f.run(args); assert.equal(result.status, 0, result.stderr + result.stdout);
    assert.match(result.stdout, /T-0001/);
    if (args.includes('--json')) {
      const body = JSON.parse(result.stdout); assert.equal(body.inspection.status, 'not_inspected');
      assert.equal(body.nextTask.id, 'T-0001'); assert(!Object.hasOwn(body, 'envInfo'));
    }
  }
  const compact = f.run(['handoff', '--compact'], { env: { ...f.env, LEERNESS_INTERNAL: '1' } });
  const mcp = f.rpc([['leerness_handoff', {}]])[0]; assert.equal(mcp.result.isError, false);
  assert.equal(mcp.result.content[0].text, compact.stdout); assert.deepEqual(bytes(f.root), before);
}));
test('MCP invalid session keys stay protocol errors and read-only policy stays enforced', () => fixture(f => {
  const result = f.rpc([['leerness_state_show', { sessionKey: 'bad' }], ['leerness_task_list', { sessionKey: 'test-session-0001' }]]);
  assert.equal(result[0].error.code, -32602); assert.equal(result[1].error.code, -32602);
  const source = fs.readFileSync(CLI, 'utf8');
  assert(source.indexOf('_policyEnforce(targetPath, cliArgs.join') < source.indexOf('const directStoredRead ='));
}));
test('default CLI and MCP stored reads make no network attempt or CLI child with OFFLINE absent', () => fixture(f => {
  const guard = path.join(f.root, 'guard.cjs'), events = path.join(f.root, 'events.log');
  fs.writeFileSync(guard, `const fs=require('fs'),cp=require('child_process'),path=require('path');
const note=(kind,detail)=>fs.appendFileSync(process.env.STORED_EVENTS,JSON.stringify({kind,detail})+'\\n');
for(const name of ['spawnSync','spawn','execSync','exec','execFile','execFileSync','fork']){const original=cp[name];cp[name]=function(file,args){const base=path.basename(String(file)).toLowerCase(),values=Array.isArray(args)?args.map(String):[];note('child',[String(file),...values]);const system=process.env.SystemRoot||process.env.WINDIR;const git=(base==='git'||base==='git.exe')&&values.includes('rev-parse');const where=system&&file===path.join(system,'System32','where.exe')&&values.length===1&&values[0]==='git';const chcp=system&&file===path.join(system,'System32','chcp.com')&&(values.length===0||(values.length===1&&values[0]==='65001'));if(!git&&!where&&!chcp)throw new Error('Unexpected child');return original.apply(this,arguments);};}
const block=name=>()=>{note('network',name);throw new Error('Blocked network');};
if(globalThis.fetch)globalThis.fetch=block('fetch');
for(const [name,methods] of [['http',['get','request']],['https',['get','request']],['net',['connect','createConnection']],['tls',['connect']],['http2',['connect']]])for(const method of methods)require(name)[method]=block(name+'.'+method);
require('net').Socket.prototype.connect=block('socket');require('dgram').Socket.prototype.send=block('udp');require('dgram').Socket.prototype.connect=block('udp-connect');
for(const obj of [require('dns'),require('dns').promises])for(const key of Object.keys(obj))if(/^(lookup|resolve|reverse)/.test(key)&&typeof obj[key]==='function')obj[key]=block('dns');
`);
  const env = { ...f.env, NODE_OPTIONS: '--require=' + JSON.stringify(guard), STORED_EVENTS: events };
  assert(!Object.hasOwn(env, 'LEERNESS_OFFLINE')); const before = bytes(f.root);
  for (const args of [['handoff'], ['handoff', '--json'], ['handoff', '--compact'], ['task', 'list', '--json'], ['state', 'show', '--json']]) {
    const r = f.run(args, { env }); assert.equal(r.status, 0, r.stderr + r.stdout);
  }
  for (const message of f.rpc([['leerness_handoff', {}], ['leerness_task_list', {}], ['leerness_state_show', {}]], { env })) assert.equal(message.result?.isError, false, JSON.stringify(message));
  const observed = fs.readFileSync(events, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
  assert(!observed.some(e => e.kind === 'network')); assert(!observed.some(e => e.kind === 'child' && e.detail[0] === process.execPath));
  fs.unlinkSync(events); assert.deepEqual(bytes(f.root), before);
  const control = cp.spawnSync(process.execPath, ['-e', 'try{require("http").get("http://127.0.0.1:9")}catch{}'], { env, encoding: 'utf8', timeout: 5000 });
  assert.equal(control.status, 0); assert(fs.readFileSync(events, 'utf8').includes('"network"'));
}));

test('uninitialized task reads remain errors and MCP handoff preserves the initialization notice', () => fixture(f => {
  const root = path.join(f.root, 'empty'); fs.mkdirSync(root);
  const cli = cp.spawnSync(process.execPath, [CLI, 'task', 'list', '--json', '--path', root], { env: f.env, encoding: 'utf8', timeout: 10000 });
  assert.equal(cli.status, 1); assert.equal(JSON.parse(cli.stdout).code, 'error');
  const results = f.rpc([['leerness_task_list', { path: root }], ['leerness_handoff', { path: root }]]);
  assert.equal(results[0].result.isError, true); assert.equal(results[0].result.content[0].text, cli.stdout);
  assert.equal(results[1].result.isError, false); assert.match(results[1].result.content[0].text, /init 미실행/);
}));
test('quiet flags retain the existing stored-read output contract', () => fixture(f => {
  for (const args of [['handoff', '--compact'], ['handoff', '--json'], ['task', 'list'], ['state', 'show', '--json']]) {
    const ordinary = f.run(args), quiet = f.run([...args, '--quiet']);
    assert.equal(ordinary.status, 0); assert.equal(quiet.status, 0); assert.equal(quiet.stdout, ordinary.stdout);
  }
}));
test('handoff preview, session and reporting inputs participate in revalidation', () => fixture(f => {
  const reader = require('../bin/leerness')._storedHandoffRead;
  f.put('previews.json', []); f.put('toggles.json', { 'plain-language-reporting': true });
  f.put('plain-language-reporting.md', '# reporting policy');
  f.put('cache/sessions/read-fixture-0001.json', { sessionKey: 'read-fixture-0001', openedAt: '2026-10-30T00:00:00Z' });
  for (const file of ['previews.json', 'toggles.json', 'plain-language-reporting.md', 'cache/sessions/read-fixture-0001.json']) {
    const before = reader(f.root, { json: true, language: 'ko', env: f.env });
    fs.appendFileSync(path.join(f.root, '.leerness', file), '\n');
    assert.throws(() => before.snapshot.verify(), { code: 'E_STORE_CHANGED' });
  }
}));
test('plain handoff tolerates an actual peer session update without writing', () => fixture(f => {
  const reader = require('../bin/leerness')._storedHandoffRead;
  const env = { ...f.env, LEERNESS_SESSION_ID: 'plain-session-peer-0001' };
  const seed = f.run(['handoff', '--record'], { env }); assert.equal(seed.status, 0, seed.stderr + seed.stdout);
  const before = bytes(f.root), result = reader(f.root, { language: 'ko', env: f.env });
  assert.deepEqual(bytes(f.root), before); assert.doesNotThrow(() => result.snapshot.verify());
  const peer = f.run(['handoff', '--record'], { env }); assert.equal(peer.status, 0, peer.stderr + peer.stdout);
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.root, '.leerness/cache/sessions/plain-session-peer-0001.json'), 'utf8')).handoffCount, 2);
  const afterPeer = bytes(f.root); assert.doesNotThrow(() => result.snapshot.verify()); assert.deepEqual(bytes(f.root), afterPeer);
}));
test('json and compact handoff still revalidate an actual peer session update', () => fixture(f => {
  const reader = require('../bin/leerness')._storedHandoffRead;
  const env = { ...f.env, LEERNESS_SESSION_ID: 'strict-session-peer-0001' };
  const seed = f.run(['handoff', '--record'], { env }); assert.equal(seed.status, 0, seed.stderr + seed.stdout);
  for (const transport of [{ json: true }, { compact: true }]) {
    const before = bytes(f.root), result = reader(f.root, { ...transport, language: 'ko', env: f.env });
    assert.deepEqual(bytes(f.root), before); assert.doesNotThrow(() => result.snapshot.verify());
    assert(result.snapshot.revision().selectedSources.some(source => source.path === '.leerness/cache/sessions/strict-session-peer-0001.json'));
    const peer = f.run(['handoff', '--record'], { env }); assert.equal(peer.status, 0, peer.stderr + peer.stdout);
    const afterPeer = bytes(f.root); assert.throws(() => result.snapshot.verify(), { code: 'E_STORE_CHANGED' }); assert.deepEqual(bytes(f.root), afterPeer);
  }
}));
test('plain handoff still revalidates tracker and user rules without writing', () => fixture(f => {
  const reader = require('../bin/leerness')._storedHandoffRead;
  for (const file of ['progress-tracker.md', 'rules.md']) {
    const before = bytes(f.root), result = reader(f.root, { language: 'ko', env: f.env });
    assert.deepEqual(bytes(f.root), before); assert.doesNotThrow(() => result.snapshot.verify());
    fs.appendFileSync(path.join(f.root, '.leerness', file), '\n');
    const changed = bytes(f.root); assert.throws(() => result.snapshot.verify(), { code: 'E_STORE_CHANGED' }); assert.deepEqual(bytes(f.root), changed);
  }
}));
test('the snapshot carries the repository topology', () => fixture(f => {
  assert.equal(createSnapshot(f.root).git, null);
  const init = cp.spawnSync('git', ['init', '-q'], { cwd: f.root, env: { ...f.env, GIT_CONFIG_NOSYSTEM: '1' }, encoding: 'utf8' });
  assert.equal(init.status, 0, init.stderr);
  const { git } = createSnapshot(f.root), same = (a, b) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b);
  assert(same(git.gitCommonDir, fs.realpathSync.native(path.join(f.root, '.git'))), JSON.stringify(git));
  assert(same(git.worktreeRoot, fs.realpathSync.native(f.root)), JSON.stringify(git));
}));
test('a loop ledger is read outside the snapshot, so a peer recording a round cannot fail the read', () => fixture(f => {
  const reader = require('../bin/leerness')._storedHandoffRead, read = () => reader(f.root, { json: true, language: 'en', env: f.env });
  const init = cp.spawnSync('git', ['init', '-q'], { cwd: f.root, env: { ...f.env, GIT_CONFIG_NOSYSTEM: '1' }, encoding: 'utf8' });
  assert.equal(init.status, 0, init.stderr);
  assert.equal(read().data.loopGuard.state, 'absent');
  assert.equal(f.run(['loop', 'open', 'peer subject']).status, 0);
  for (const spot of ['a', 'b']) assert.equal(f.run(['loop', 'round', 'L-0001', '--spot', spot]).status, 0);
  const result = read();
  assert.deepEqual(result.data.loopGuard.open, [{ id: 'L-0001', subject: 'peer subject', rounds: 2, cap: 3 }]);
  assert.equal(f.run(['loop', 'round', 'L-0001', '--spot', 'c']).status, 3);
  assert.doesNotThrow(() => result.snapshot.verify());
  assert.equal(read().data.loopGuard.stopped[0].id, 'L-0001');
  fs.appendFileSync(path.join(f.root, '.leerness', 'plan.md'), '\n');
  assert.throws(() => result.snapshot.verify(), { code: 'E_STORE_CHANGED' });
}));
test('plain handoff keeps pending and unreadable preview state distinct from a healthy empty store', () => fixture(f => {
  for (const args of [['handoff'], ['handoff', '--record']]) {
    f.put('previews.json', []);
    const empty = f.run(args);
    assert.equal(empty.status, 0, empty.stderr); assert.doesNotMatch(empty.stdout, /미리보기/);
    f.put('previews.json', [{ id: 'P-0001', title: 'x', status: 'proposed' }]);
    const waiting = f.run(args);
    assert.equal(waiting.status, 0, waiting.stderr); assert.match(waiting.stdout, /미승인 미리보기 1건/);
    f.put('previews.json', '{not json');
    const corrupt = f.run(args);
    assert.equal(corrupt.status, 0, corrupt.stderr); assert.ok(corrupt.stdout.includes('미리보기 승인 상태 불명 (store_corrupt)'), corrupt.stdout); assert.doesNotMatch(corrupt.stdout, /미승인 미리보기/);
  }
}));
test('canonical root aliases work but retargeting an alias invalidates its snapshot', t => fixture(f => {
  const alias = path.join(f.root, 'alias'), target = path.join(f.root, 'target');
  fs.mkdirSync(target); fs.mkdirSync(path.join(target, '.leerness'));
  fs.writeFileSync(path.join(target, '.leerness/progress-tracker.md'), row('T-0001', 'planned'));
  try { fs.symlinkSync(target, alias, process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) { if (['EPERM', 'EACCES', 'ENOSYS'].includes(error.code)) { t.skip('Platform denied alias fixture'); return; } throw error; }
  const result = taskList(alias); assert.equal(result.data.tasks[0].id, 'T-0001');
  fs.unlinkSync(alias); const other = path.join(f.root, 'other'); fs.mkdirSync(other);
  fs.symlinkSync(other, alias, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => result.snapshot.verify(), { code: 'E_STORE_CHANGED' });
}));
test('MCP direct reads do not bypass the existing enforced tool minimum tier', () => fixture(f => {
  f.put('policy.json', { allowedTier: 'read-only', enforce: true });
  const before = bytes(f.root), responses = f.rpc([['leerness_task_list', {}], ['leerness_state_show', {}], ['leerness_handoff', {}]]);
  assert.equal(responses[0].result.isError, false); assert.equal(responses[1].result.isError, false);
  assert.equal(responses[2].result.isError, true); assert.match(responses[2].result.content[0].text, /policy/);
  assert.deepEqual(bytes(f.root), before);
}));

function realShortAlias(root, t) {
  const system = process.env.SystemRoot || process.env.WINDIR;
  const powershell = path.join(system, 'System32/WindowsPowerShell/v1.0/powershell.exe');
  const source = '[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false);'
    + 'Add-Type -TypeDefinition \'using System.Text;using System.Runtime.InteropServices;public static class ShortAliasProbe{[DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)]public static extern uint GetShortPathName(string p,StringBuilder b,uint n);}\';'
    + '$b=New-Object System.Text.StringBuilder 32768;'
    + '$n=[ShortAliasProbe]::GetShortPathName($env:LEERNESS_ALIAS_FIXTURE,$b,32768);if($n -eq 0){throw "GetShortPathName failed"};[Console]::Write($b.ToString());';
  const result = cp.spawnSync(powershell, ['-NoProfile', '-NonInteractive', '-Command', source], {
    env: { ...process.env, LEERNESS_ALIAS_FIXTURE: root }, encoding: 'utf8', timeout: 30000, windowsHide: true
  });
  assert.ifError(result.error);assert.equal(result.status, 0, result.stderr);
  const alias = result.stdout.trim();
  if (alias.toLowerCase() === root.toLowerCase()) { t.skip('Real 8.3 spelling unavailable for this owned fixture'); return null; }
  assert.equal(fs.realpathSync.native(alias).toLowerCase(), fs.realpathSync.native(root).toLowerCase());
  return alias;
}

test('snapshot description keeps frozen ownership and refuses a changed publication winner', () => fixture(f => {
  f.put('review-evidence.md', 'Original evidence\r\n');f.put('other.md', 'Other owner\n');
  const file = path.join(f.root, '.leerness/review-evidence.md'), other = path.join(f.root, '.leerness/other.md');
  const snapshot = createSnapshot(f.root), input = snapshot.capture(file), original = fs.readFileSync(file);
  const before = snapshot.describe(file);
  assert.equal(before.stat.size, String(original.length));
  assert.throws(() => require('../lib/memory-input').describeCheckedFileInput(input, other), { code: 'E_STORE_INVALID' });
  const winner = Buffer.from('Independent winner bytes remain\r\n');fs.writeFileSync(file, winner);
  assert.deepEqual(snapshot.describe(file), before);assert.equal(snapshot.read(file), original.toString('utf8'));
  assert.throws(() => snapshot.verify(), { code: 'E_STORE_CHANGED' });
  assert.throws(() => require('../lib/io').writeBufferIfUnchanged(file, original, Buffer.from('must not overwrite')), { code: process.platform === 'win32' ? 'E_CONCURRENT_MODIFICATION' : 'E_METADATA_PRESERVATION_UNAVAILABLE' });
  assert.deepEqual(fs.readFileSync(file), winner);
}));

test('real Windows 8.3 snapshot descriptions align without weakening exact owner checks', { skip: process.platform !== 'win32' }, t => fixture(f => {
  f.put('review-evidence.md', 'Original Unicode 한글 e\u0301\r\n');
  const alias = realShortAlias(f.root, t);if (!alias) return;
  const file = path.join(alias, '.leerness/review-evidence.md'), snapshot = createSnapshot(alias), input = snapshot.capture(file);
  assert.deepEqual(snapshot.describe(file), createSnapshot(f.root).describe(path.join(f.root, '.leerness/review-evidence.md')));
  assert.throws(() => require('../lib/memory-input').describeCheckedFileInput(input, file), { code: 'E_STORE_INVALID' });
  assert.doesNotThrow(() => snapshot.verify());
  fs.appendFileSync(path.join(f.root, '.leerness/review-evidence.md'), 'later winner');
  assert.throws(() => snapshot.verify(), { code: 'E_STORE_CHANGED' });
}));

test('real Windows 8.3 guide fuzzy and NaN lessons match normal CLI spelling', { skip: process.platform !== 'win32' }, t => fixture(f => {
  const alias = realShortAlias(f.root, t);if (!alias) return;
  fs.mkdirSync(path.join(f.root, 'src/components'), { recursive: true });fs.writeFileSync(path.join(f.root, 'src/components/Card.html'), '<div>Card</div>\n');
  f.put('review-evidence.md', '## 2026-04\nNote: ✗ webhooks payload 실패\n');
  f.put('skills/webhook/skill.json', { name: 'webhook', description: 'webhook integration' });
  f.put('skill-suggestions.md', '## 2026-11-08 12:00 — query "webhook"\n- [0.9] webhook original skill history\n');
  const env = { ...f.env, LEERNESS_OFFLINE: '1', LEERNESS_NO_AUTOCHCP: '1', LEERNESS_NO_PATH_CHECK: '1' };
  const run = (root, args) => cp.spawnSync(process.execPath, [CLI, ...args, '--path', root], { cwd: f.root, env, encoding: 'utf8', timeout: 60000, maxBuffer: 8 * 1024 * 1024, windowsHide: true });
  for (const args of [['task', 'add', 'webhook 작업', '--status', 'in-progress'], ['lesson', 'save', 'ZZUNIQUE alpha lesson'], ['lesson', 'save', 'ZZUNIQUE beta lesson']]) {
    const result = run(f.root, args);assert.equal(result.status, 0, result.stderr + result.stdout);
  }
  const protectedBytes = () => Object.fromEntries(Object.entries(bytes(f.root)).filter(([name]) => name.replace(/\\/g, '/') !== '.leerness/cache/usage-stats.json'));
  const before = protectedBytes();
  for (const root of [f.root, alias]) {
    const guide = run(root, ['guide', 'src/components/Card.html']);assert.equal(guide.status, 0, guide.stderr + guide.stdout);
    const plain = run(root, ['handoff', '--no-drift-check', '--no-workflow-guide']);assert.equal(plain.status, 0, plain.stderr + plain.stdout);assert.doesNotMatch(plain.stdout, /lessons 자동 재상기/);
    const inspected = run(root, ['handoff', '--inspect', '--no-drift-check', '--no-workflow-guide']);assert.equal(inspected.status, 0, inspected.stderr + inspected.stdout);assert.match(inspected.stdout, /lessons 자동 재상기.*webhook/);assert.match(inspected.stdout, /이전 skill match 이력/);assert.match(inspected.stdout, /query "webhook"/);
    const lessons = run(root, ['lessons', 'ZZUNIQUE', '--limit', 'abc']);assert.equal(lessons.status, 0, lessons.stderr + lessons.stdout);assert.match(lessons.stdout, /ZZUNIQUE/);
    const automatic = run(root, ['lessons', '--auto']);assert.equal(automatic.status, 0, automatic.stderr + automatic.stdout);assert.match(automatic.stdout, /webhook/);
    assert.deepEqual(protectedBytes(), before);
  }
}));

test('snapshot description retains missing-file absent-parent and replaced-identity guards', () => fixture(f => {
  const missing = path.join(f.root, '.leerness/missing.md'), absent = path.join(f.root, '.leerness/absent/file.md');
  const snapshot = createSnapshot(f.root);
  assert.equal(snapshot.describe(missing).stat, null);assert.equal(snapshot.describe(absent), null);
  f.put('absent/file.md', 'new parent appeared');assert.throws(() => snapshot.verify(), { code: 'E_STORE_CHANGED' });
  const file = path.join(f.root, '.leerness/rules.md'), bytes = fs.readFileSync(file), old = createSnapshot(f.root);
  const descriptor = old.describe(file);
  fs.renameSync(file, file + '.retained-original');fs.writeFileSync(file, bytes);
  assert.notEqual(String(fs.lstatSync(file, { bigint: true }).ino), descriptor.stat.ino);
  assert.deepEqual(old.describe(file), descriptor);assert.throws(() => old.verify(), { code: 'E_STORE_CHANGED' });
  assert.deepEqual(fs.readFileSync(file + '.retained-original'), bytes);
}));

test('snapshot description still refuses an internal reparse parent', t => fixture(f => {
  f.put('target/file.md', 'Target bytes');
  const target = path.join(f.root, '.leerness/target'), alias = path.join(f.root, '.leerness/internal-link');
  try { fs.symlinkSync(target, alias, process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) { if (['EPERM', 'EACCES', 'ENOSYS'].includes(error.code)) { t.skip('Platform denied internal alias fixture'); return; } throw error; }
  const before = fs.readFileSync(path.join(target, 'file.md'));
  assert.throws(() => createSnapshot(f.root).describe(path.join(alias, 'file.md')), { code: 'E_STORE_INVALID' });
  assert.deepEqual(fs.readFileSync(path.join(target, 'file.md')), before);
}));

test('real Windows 8.3 current and legacy handoff freshness use owned descriptions', { skip: process.platform !== 'win32' }, t => fixture(f => {
  const alias = realShortAlias(f.root, t);if (!alias) return;
  const core = require('../bin/leerness'), marker = path.join(f.root, '.leerness/cache/handoffs/unaddressed.json');
  const history = ['2026-11-08T12:00:00.000Z'];
  f.put('cache/handoffs/unaddressed.json', { schemaVersion: 1, sessionKey: null, last: history[0], history });
  const saved = {};
  for (const key of ['LEERNESS_SESSION_ID', 'CLAUDE_CODE_HOST_SESSION_ID', 'CLAUDE_CODE_SESSION_ID', 'CODEX_THREAD_ID']) { saved[key] = process.env[key];delete process.env[key]; }
  try {
    const before = bytes(f.root), current = core._getLastHandoffGap(alias);
    assert.equal(current.hasLast, true);assert.deepEqual(current.history, history);assert.deepEqual(bytes(f.root), before);
    fs.renameSync(marker, marker + '.retained-original');f.put('last-handoff.json', { last: history[0], history });
    const legacyBefore = bytes(f.root), legacy = core._getLastHandoffGap(alias);
    assert.equal(legacy.hasLast, true);assert.deepEqual(legacy.history, history);assert.deepEqual(bytes(f.root), legacyBefore);
  } finally {
    for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key];else process.env[key] = value; }
  }
}));
