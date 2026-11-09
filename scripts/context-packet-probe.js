'use strict';
require('./temp-cleanup').trackTemp(module);
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
const { removeSync } = require('../lib/safe-remove');
const { createHash } = require('node:crypto');
const service = require('../lib/context-packet');
const transport = require('../lib/context-packet-transport');
const cli = path.resolve(__dirname, '../bin/leerness.js');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const plain = result => { const next = structuredClone(result); delete next.observedAt; return next; };
const row = (id, request = '한글 🐝 e\u0301 작업') => `| ${id} | in-progress | ${request} | exact evidence | next action | 2026-10-30 |\r\n`;
function fixture(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-packet-é-한글-'));
  fs.mkdirSync(path.join(root, '.leerness'));
  const put = (id, bytes) => fs.writeFileSync(path.join(root, service.SOURCES.find(s => s.id === id).file), bytes);
  for (const spec of service.SOURCES) {
    if (spec.role === 'required') put(spec.id, '# ' + spec.id + '\r\n정책 🐝 e\u0301\r\n');
  }
  put('tasks', '# Tasks\r\n' + row('T-0001') + row('T-0002'));
  put('plan', '<!-- leerness:owner-priorities:start -->\n1. T-0001\n<!-- leerness:owner-priorities:end -->\n');
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (/^(?:LEERNESS_|_LEERNESS_|GIT_)/i.test(key)) delete env[key];
  Object.assign(env, { LEERNESS_NO_BANNER: '1', LEERNESS_NO_PROMPT: '1', LEERNESS_NO_STALE_CHECK: '1', NO_COLOR: '1' });
  const run = (args, options = {}) => cp.spawnSync(process.execPath, [cli, ...args, '--path', root], { encoding: 'utf8', timeout: 20000, env, ...options });
  try { return fn({ root, put, env, run }); }
  finally { removeSync(root, { recursive: true, force: true }); }
}
function bounded(response) {
  const text = JSON.stringify(response) + '\n';
  assert(Buffer.byteLength(text, 'utf8') <= 8192);
  assert.deepEqual(JSON.parse(text), response);
}
function tree(root) {
  const result = {};
  const walk = dir => {
    for (const name of fs.readdirSync(dir)) {
      const file = path.join(dir, name), stat = fs.lstatSync(file);
      if (stat.isDirectory()) walk(file); else result[path.relative(root, file)] = hash(fs.readFileSync(file));
    }
  };
  walk(root); return result;
}
test('complete compact packet preserves UTF-8 policy and chooses actual owner priority', () => fixture(f => {
  const before = tree(f.root), packet = service.currentPacket(f.root);
  bounded(packet); assert.equal(packet.complete, true); assert.equal(packet.data.task.id, 'T-0001');
  assert.deepEqual(packet.missingRequiredIds, []); assert.equal(packet.data.selection, 'owner-priorities');
  for (const policy of packet.data.policies) {
    assert.equal(policy.text, fs.readFileSync(path.join(f.root, service.SOURCES.find(s => s.id === policy.id).file), 'utf8'));
    assert.equal(policy.unabridged, true);
  }
  assert.deepEqual(tree(f.root), before);
}));
test('explicit task selection and no-actionable state are not inferred task completion', () => fixture(f => {
  assert.equal(service.currentPacket(f.root, { task: 'T-0002' }).data.task.id, 'T-0002');
  f.put('tasks', '# Tasks\n' + row('T-0001').replace('in-progress', 'done'));
  const packet = service.currentPacket(f.root); assert.equal(packet.data.task, null); assert.equal(packet.data.selection, 'none');
  assert.equal(service.currentPacket(f.root, { task: 'T-0001' }).data.task.status, 'done');
}));
test('oversized required policies are omitted whole with every missing ID retained', () => fixture(f => {
  const ids = service.SOURCES.filter(s => s.role === 'required').map(s => s.id);
  for (const id of ids) f.put(id, '한글🐝e\u0301"\\\r\n'.repeat(2000));
  const packet = service.currentPacket(f.root); bounded(packet);
  assert.equal(packet.complete, false); assert.equal(packet.data.task.id, 'T-0001');
  assert.deepEqual(packet.missingRequiredIds, ids); assert.equal(packet.missingRequiredCount, ids.length);
  assert.deepEqual(packet.data.policies, []);
}));
test('an oversized selected task is referenced, never truncated or lost', () => fixture(f => {
  const original = Buffer.from(row('T-0001', '작업🐝'.repeat(2000)));
  f.put('tasks', original);
  const packet = service.currentPacket(f.root); bounded(packet);
  assert.equal(packet.data.task, null); assert.equal(packet.complete, false);
  assert(packet.missingRequiredIds.includes('task:T-0001'));
  assert.equal(packet.data.taskSource.sha256, hash(original));
  const parts = []; let offset = 0;
  do {
    const page = service.exactSource(f.root, { id: 'task:T-0001', revision: packet.data.taskSource.sha256, offset }); bounded(page);
    parts.push(Buffer.from(page.data.bytes, 'base64')); offset = page.data.nextOffset;
  } while (offset !== null);
  assert.deepEqual(Buffer.concat(parts), original);
}));
test('exact source pages preserve BOM, CRLF, emoji and combining bytes', () => fixture(f => {
  const original = Buffer.from('\ufeff# 원문\r\n' + '가🐝e\u0301\r\n'.repeat(600)); f.put('rules', original);
  const packet = service.currentPacket(f.root), expected = packet.sourceRevision.selectedSources.find(s => s.id === 'rules').sha256;
  const parts = []; let offset = 0;
  do {
    const page = service.exactSource(f.root, { id: 'rules', revision: expected, offset }); bounded(page);
    assert.equal(page.data.offset, offset); assert.equal(page.data.sha256, hash(original));
    parts.push(Buffer.from(page.data.bytes, 'base64')); offset = page.data.nextOffset;
  } while (offset !== null);
  assert.deepEqual(Buffer.concat(parts), original);
}));
test('missing required policy stays incomplete; absent optional source is not invented', () => fixture(f => {
  fs.unlinkSync(path.join(f.root, '.leerness/rules.md'));
  const packet = service.currentPacket(f.root); bounded(packet);
  assert.equal(packet.complete, false); assert(packet.missingRequiredIds.includes('rules'));
  assert(packet.warnings.some(w => w.code === 'source_missing' && w.id === 'rules'));
  assert(!packet.missingRequiredIds.includes('source-of-truth'));
}));
test('project source-of-truth takes a whole-source required reference when present', () => fixture(f => {
  f.put('source-of-truth', 'Required private/public boundary\n'.repeat(1000));
  const packet = service.currentPacket(f.root);
  assert(packet.missingRequiredIds.includes('source-of-truth')); assert.equal(packet.complete, false);
}));
test('source changes reject a previously captured snapshot and exact page revision', () => fixture(f => {
  const snapshot = service.captureSnapshot(f.root), first = service.renderPacket(snapshot);
  const old = first.sourceRevision.selectedSources.find(s => s.id === 'rules').sha256;
  f.put('rules', 'new policy');
  assert.throws(() => service.renderPacket(snapshot), { code: 'E_STORE_CHANGED' });
  assert.throws(() => service.exactSource(f.root, { id: 'rules', revision: old }), { code: 'source_changed' });
  const next = service.currentPacket(f.root); assert.notEqual(next.sourceRevision.selectionDigest, first.sourceRevision.selectionDigest);
}));
test('same-HEAD dirty policy bytes change sourceRevision without a commit', () => fixture(f => {
  for (const args of [['init', '-q', f.root], ['-C', f.root, 'add', '.'], ['-C', f.root, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'fixture']]) {
    const result = cp.spawnSync('git', args, { env: f.env, encoding: 'utf8', shell: false }); assert.equal(result.status, 0, result.stderr);
  }
  const before = service.currentPacket(f.root);
  assert.match(before.sourceRevision.gitCommit, /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/);
  f.put('rules', 'dirty selected policy\n'); const after = service.currentPacket(f.root);
  assert.equal(after.sourceRevision.gitCommit, before.sourceRevision.gitCommit);
  assert.notEqual(after.sourceRevision.selectionDigest, before.sourceRevision.selectionDigest);
}));
test('stale/corrupt historical index does not trigger history-body scans or empty source fallback', () => fixture(f => {
  const dir = path.join(f.root, '.leerness/archive/history'); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.json'), '{ invalid stale index');
  fs.writeFileSync(path.join(dir, 'history.md'), 'unrelated secret-shaped fixture'.repeat(50000));
  const packet = service.currentPacket(f.root); assert.equal(packet.data.task.id, 'T-0001');
  assert.equal(packet.measurements.historyBodiesRead, 0); assert.equal(packet.measurements.cacheUsed, false);
  assert(!JSON.stringify(packet).includes('secret-shaped'));
}));
test('read measurements count actual selected bytes, successful revalidation and unique files', () => fixture(f => {
  const packet = service.currentPacket(f.root);
  const selected = packet.sourceRevision.selectedSources.filter(s => s.state === 'present');
  assert.equal(packet.measurements.readBytes, 2 * selected.reduce((n, s) => n + s.byteLength, 0));
  assert.equal(packet.measurements.readFiles, selected.length);
  assert.equal(packet.measurements.readOperations, 2 * selected.length);
}));
test('same opaque snapshot renders semantically identical results without mutable aliasing', () => fixture(f => {
  const snapshot = service.captureSnapshot(f.root), first = service.renderPacket(snapshot);
  const canonical = plain(first); first.data.task.request = 'caller mutation';
  assert.deepEqual(plain(service.renderPacket(snapshot)), canonical);
  assert.throws(() => service.renderPacket({}), { code: 'invalid_snapshot' });
}));
test('duplicate and malformed task rows fail closed without making an empty healthy packet', () => fixture(f => {
  f.put('tasks', row('T-0001') + row('T-0001'));
  const duplicate = transport.evaluate('packet', { path: f.root }); assert.equal(duplicate.error.code, 'task_source_invalid'); bounded(duplicate);
  f.put('tasks', '| T-0001 | planned | broken |\n');
  assert.equal(transport.evaluate('packet', { path: f.root }).error.code, 'task_source_invalid');
  fs.unlinkSync(path.join(f.root, '.leerness/progress-tracker.md'));
  assert.equal(transport.evaluate('packet', { path: f.root }).error.code, 'task_source_missing');
}));
test('invalid UTF-8 and input overflow return bounded sanitized errors, preserving originals', () => fixture(f => {
  for (const [bytes, expected] of [[Buffer.from([255, 254, 0]), 'invalid_utf8'], [Buffer.alloc(4 * 1024 * 1024 + 1, 65), 'input_too_large']]) {
    f.put('rules', bytes); const result = transport.evaluate('packet', { path: f.root }); bounded(result);
    assert.equal(result.error.code, expected); assert.equal(result.complete, false);
    assert.equal(result.data, null); assert(!JSON.stringify(result).includes(f.root));
    assert.deepEqual(fs.readFileSync(path.join(f.root, '.leerness/rules.md')), bytes);
  }
}));
test('linked required source is rejected without reading external source', t => fixture(f => {
  const file = path.join(f.root, '.leerness/rules.md'), outside = path.join(f.root, 'outside.txt');
  fs.unlinkSync(file); fs.writeFileSync(outside, 'outside source must not be read');
  try { fs.symlinkSync(outside, file); } catch (error) { if (['EPERM', 'EACCES', 'ENOSYS'].includes(error.code)) { t.skip('Platform denied fixture symlink'); return; } throw error; }
  const result = transport.evaluate('packet', { path: f.root }); assert.equal(result.ok, false);
  assert(!JSON.stringify(result).includes('outside source must not be read'));
}));
test('exact lookup rejects arbitrary paths, wrong digest, invalid offsets and unknown fields', () => fixture(f => {
  const digest = hash(fs.readFileSync(path.join(f.root, '.leerness/rules.md')));
  for (const options of [{ id: '../outside', revision: digest }, { id: 'rules', revision: '0'.repeat(64) },
    { id: 'rules', revision: digest, offset: 99999 }, { id: 'rules', revision: digest, offset: -1 },
    { id: 'rules', revision: digest, offset: 0.5 }, { id: 'rules', revision: digest, sessionKey: 'invented' }]) {
    const result = transport.evaluate('source', { path: f.root, ...options }); bounded(result); assert.equal(result.ok, false);
  }
}));
test('CLI and MCP share direct packet/source responses and preserve project bytes with OFFLINE unset', () => fixture(f => {
  const guard = path.join(f.root, 'guard.cjs'), events = path.join(f.root, 'events.log');
  fs.writeFileSync(guard, `const fs=require('fs'),cp=require('child_process'),path=require('path');
const note=(kind,detail)=>fs.appendFileSync(process.env.PACKET_EVENTS,JSON.stringify({kind,detail})+'\\n');
for(const name of ['spawnSync','spawn','execSync','exec','execFile','execFileSync','fork']){const original=cp[name];cp[name]=function(file,args){const base=path.basename(String(file)).toLowerCase();const values=Array.isArray(args)?args.map(String):[];note('child',[file,...values]);if(!((base==='git'||base==='git.exe')&&values.includes('rev-parse'))&&!(base==='where.exe'&&values.length===1&&values[0]==='git')&&base!=='chcp.com')throw new Error('Unexpected child');return original.apply(this,arguments);};}
const block=(name)=>()=>{note('network',name);throw new Error('Blocked network');};
if(globalThis.fetch)globalThis.fetch=block('fetch');
for(const [name,methods] of [['http',['get','request']],['https',['get','request']],['net',['connect','createConnection']],['tls',['connect']],['http2',['connect']]])for(const method of methods)require(name)[method]=block(name+'.'+method);
require('net').Socket.prototype.connect=block('socket');require('dgram').Socket.prototype.send=block('udp');
for(const obj of [require('dns'),require('dns').promises])for(const key of Object.keys(obj))if(/^(lookup|resolve|reverse)/.test(key)&&typeof obj[key]==='function')obj[key]=block('dns');
`);
  const env = { ...f.env, NODE_OPTIONS: '--require=' + JSON.stringify(guard), PACKET_EVENTS: events };
  const before = tree(f.root);
  const packetCli = f.run(['context', 'packet', '--json'], { env }); assert.equal(packetCli.status, 0, packetCli.stderr);
  const packet = JSON.parse(packetCli.stdout); bounded(packet);
  const revision = packet.sourceRevision.selectedSources.find(s => s.id === 'rules').sha256;
  const sourceCli = f.run(['context', 'source', '--id', 'rules', '--revision', revision, '--json'], { env }); assert.equal(sourceCli.status, 0, sourceCli.stderr);
  const requests = [{ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'leerness_context_packet', arguments: { path: f.root } } },
    { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'leerness_context_source', arguments: { path: f.root, id: 'rules', revision } } }];
  const mcp = f.run(['mcp', 'serve', '--profile', 'core'], { env, input: requests.map(r => JSON.stringify(r)).join('\n') + '\n' });
  assert.equal(mcp.status, 0, mcp.stderr);
  const responses = mcp.stdout.trim().split('\n').map(line => JSON.parse(line)); assert.equal(responses.length, 2);
  for (const response of responses) assert.equal(response.result.isError, false, JSON.stringify(response));
  assert.deepEqual(plain(JSON.parse(responses[0].result.content[0].text)), plain(packet));
  assert.deepEqual(plain(JSON.parse(responses[1].result.content[0].text)), plain(JSON.parse(sourceCli.stdout)));
  const observed = fs.readFileSync(events, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  assert(!observed.some(event => event.kind === 'network'));
  assert(!observed.some(event => event.kind === 'child' && event.detail[0] === process.execPath));
  fs.unlinkSync(events); assert.deepEqual(tree(f.root), before);
  const control = cp.spawnSync(process.execPath, ['-e', 'try{require("http").get("http://127.0.0.1:9")}catch{}'], { env, encoding: 'utf8', timeout: 5000 });
  assert.equal(control.status, 0); assert(fs.readFileSync(events, 'utf8').includes('"network"'));
}));
test('CLI rejects duplicate flags and keeps complete source lookup help', () => fixture(f => {
  const result = f.run(['context', 'packet', '--task', 'T-0001', '--task', 'T-0002', '--json']);
  assert.equal(result.status, 1); assert.equal(JSON.parse(result.stdout).error.code, 'invalid_arguments');
  const help = cp.spawnSync(process.execPath, [cli, 'context', 'source', '--help'], { env: f.env, encoding: 'utf8', timeout: 10000 });
  assert.equal(help.status, 0); assert(help.stdout.includes('--revision SHA256'));
}));
test('library reads do not mutate argv/environment and explicit policy refusal stays an error', () => fixture(f => {
  const argv = process.argv.slice(), env = { ...process.env };
  service.currentPacket(f.root);
  assert.deepEqual(process.argv, argv); assert.deepEqual({ ...process.env }, env);
  const denied = transport.evaluate('packet', { path: f.root }, f.root, () => false);
  assert.equal(denied.ok, false); assert.equal(denied.error.code, 'policy_blocked'); bounded(denied);
}));
test('CLI/MCP domain errors share the same source-change semantics', () => fixture(f => {
  const request = { path: f.root, id: 'rules', revision: '0'.repeat(64) };
  const cliResult = f.run(['context', 'source', '--id', request.id, '--revision', request.revision, '--json']);
  assert.equal(cliResult.status, 1);
  const mcp = transport.mcpResult('source', request, f.root); assert.equal(mcp.isError, true);
  assert.deepEqual(plain(JSON.parse(cliResult.stdout)), plain(JSON.parse(mcp.content[0].text)));
}));
test('shared row parser keeps the legacy write row-loss guard', () => fixture(f => {
  const legacy = require('../bin/leerness');
  const file = path.join(f.root, '.leerness/progress-tracker.md');
  const malformed = '# Tasks\n' + row('T-0001') + '| T-0002 | requested | malformed |\n';
  f.put('tasks', malformed);
  legacy._withLock(file, () => {
    const input = require('../lib/managed-text').captureTextEdit(file);
    const rows = require('../lib/progress-rows').parseProgressRows(input.text);
    assert.throws(() => legacy.writeProgressRows(f.root, '# Tasks', rows, { input }), { code: 'E_PROGRESS_ROW_LOSS' });
  });
  assert.equal(fs.readFileSync(file, 'utf8'), malformed);
}));
test('shared row parser keeps authored text after the last tracker row during a real edit', () => fixture(f => {
  const legacy = require('../bin/leerness');
  const file = path.join(f.root, '.leerness/progress-tracker.md');
  const tail = '## User note\nDo not discard this authored text: 한글 🐝.\n';
  f.put('tasks', '# Tasks\n' + row('T-0001') + '\n' + tail);
  legacy._withLock(file, () => {
    const input = require('../lib/managed-text').captureTextEdit(file);
    const rows = require('../lib/progress-rows').parseProgressRows(input.text);
    rows[0].nextAction = 'updated action';
    legacy.writeProgressRows(f.root, '# Tasks', rows, { input });
  });
  const actual = fs.readFileSync(file, 'utf8');
  assert(actual.includes('updated action'));
  assert(actual.endsWith(tail), 'authored suffix was dropped');
}));
