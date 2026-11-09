'use strict';
require('./temp-cleanup').trackTemp(module);
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
const { createHash } = require('node:crypto');
const { removeSync } = require('../lib/safe-remove');
const S = require('../lib/context-packet');
const T = require('../lib/context-packet-transport');
const H = require('../lib/history-retention');
const W = require('../lib/history-retention-write');
const cli = path.resolve(__dirname, '../bin/leerness.js');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const plain = data => { const value = structuredClone(data); delete value.observedAt; return value; };
const row = (id, status, request) => `| ${id} | ${status} | ${request} | original evidence | next | 2026-10-30 |`;
function fixture(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-memory-한글-'));
  const workspace = path.join(root, '.leerness'); fs.mkdirSync(workspace);
  for (const spec of S.SOURCES.filter(s => s.role === 'required')) fs.writeFileSync(path.join(root, spec.file), '# policy\r\n');
  const tracker = path.join(workspace, 'progress-tracker.md');
  const original = Buffer.from('\ufeff' + ['---', 'leernessRole: progress-tracker', '---', '<!-- leerness:managed -->', '# Tracker', '',
    '| ID | Status | Request | Evidence | Next Action | Updated |', '|---|---|---|---|---|---|',
    row('T-0001', 'in-progress', 'Current work'), row('T-0002', 'done', '정확한 원문 🐝 e\u0301 a\\|b'), row('T-0003', 'dropped', 'Other history'), '', 'Authored footer.', ''].join('\r\n'));
  fs.writeFileSync(tracker, original);
  fs.writeFileSync(path.join(workspace, 'plan.md'), '<!-- leerness:owner-priorities:start -->\n1. T-0001\n<!-- leerness:owner-priorities:end -->\n');
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (/^(?:LEERNESS_|_LEERNESS_|GIT_)/i.test(key)) delete env[key];
  Object.assign(env, { LEERNESS_NO_BANNER: '1', LEERNESS_NO_PROMPT: '1', LEERNESS_NO_STALE_CHECK: '1', NO_COLOR: '1' });
  const put = (name, value) => fs.writeFileSync(path.join(workspace, name), typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value, null, 2) + '\n');
  const run = (args, options = {}) => cp.spawnSync(process.execPath, [cli, ...args, '--path', root], { env, encoding: 'utf8', timeout: 30000, ...options });
  const retain = (tasks = ['T-0002']) => { const p = W.preview(root, { tasks }); return W.apply(root, { tasks, expected: p.expected }); };
  try { return fn({ root, workspace, tracker, original, env, put, run, retain }); }
  finally { removeSync(root, { recursive: true, force: true }); }
}
function state(root) {
  const result = {};
  const walk = dir => { for (const name of fs.readdirSync(dir)) {
    const file = path.join(dir, name), stat = fs.lstatSync(file, { bigint: true });
    if (stat.isDirectory()) walk(file); else result[path.relative(root, file)] = [stat.isSymbolicLink() ? fs.readlinkSync(file) : sha(fs.readFileSync(file)), String(stat.mtimeNs)];
  } };
  walk(root); return result;
}
function bounded(value) {
  const json = JSON.stringify(value) + '\n'; assert(Buffer.byteLength(json) <= 8192); assert.deepEqual(JSON.parse(json), value);
}
function pages(root, id, revision) {
  let offset = 0; const chunks = [];
  do {
    const page = S.exactSource(root, { id, revision, offset }); bounded(page);
    assert.equal(page.data.offset, offset); assert(page.data.returnedBytes <= 2048);
    chunks.push(Buffer.from(page.data.bytes, 'base64')); offset = page.data.nextOffset;
  } while (offset !== null);
  return Buffer.concat(chunks);
}
function assertError(root, args, code) {
  const before = state(root), result = T.evaluate('packet', { path: root, ...args });
  assert.equal(result.ok, false, JSON.stringify(result)); assert.equal(result.error.code, code); bounded(result);
  assert(!JSON.stringify(result).includes(root)); assert.deepEqual(state(root), before);
}
test('ordinary packet does not load optional active memory or history bodies', () => fixture(f => {
  f.put('decisions.json', '{ corrupt'); f.put('lessons.json', Buffer.alloc(4 * 1024 * 1024 + 1));
  const before = state(f.root), packet = S.currentPacket(f.root);
  assert.equal(packet.data.task.id, 'T-0001'); assert(!Object.hasOwn(packet.data, 'memory'));
  assert.equal(packet.measurements.historyBodiesRead, 0); assert.deepEqual(state(f.root), before);
}));
test('task-linked canonical memories preserve fields and exclude substring task-ID matches', () => fixture(f => {
  const decision = { date: '2026-10-30', title: 'T-0001 decision', decision: '한글 🐝 e\u0301', reason: 'Reason', alternatives: null, impact: null, authoredField: 'preserve' };
  f.put('decisions.json', [decision, { title: 'T-00010 must not match' }, { title: 'unrelated' }]);
  f.put('decisions.md', 'ignored projection T-0001'); f.put('lessons.json', [{ text: 'T-0001 lesson', tag: 'exact' }]);
  const before = state(f.root), packet = S.currentPacket(f.root, { includeMemory: true }); bounded(packet);
  assert.equal(packet.complete, true); assert.equal(packet.data.memory.length, 2);
  assert.deepEqual(packet.data.memory[0].entries, [{ index: 0, value: decision }]);
  assert.equal(packet.data.memory[0].indexScope, 'source-revision-only');
  assert(!JSON.stringify(packet).includes('must not match')); assert(!JSON.stringify(packet).includes('ignored projection'));
  assert.equal(packet.data.memorySelection.method, 'exact-task-reference'); assert.deepEqual(state(f.root), before);
}));
test('explicit memory query is literal, case-insensitive and reports capped matching counts', () => fixture(f => {
  f.put('lessons.json', [{ text: 'Needle[.*] first' }, { text: 'needle[.*] second' }, { text: 'NEEDLE[.*] third' }, { text: 'wrong needle' }]);
  const p = T.evaluate('packet', { path: f.root, memoryQuery: 'needle[.*]' }); bounded(p);
  assert.equal(p.ok, true); assert.equal(p.data.memory[0].entries.length, 2);
  assert.equal(p.data.memorySelection.allMatchesSelected, false);
  assert.deepEqual(p.data.memorySelection.counts.find(c => c.surface === 'lessons'), { surface: 'lessons', state: 'json', matched: 3, selected: 2 });
}));
test('absent memory is reported without inventing records', () => fixture(f => {
  const p = S.currentPacket(f.root, { includeMemory: true }); bounded(p);
  assert.deepEqual(p.data.memory, []); assert.equal(p.data.memorySelection.counts.filter(c => c.state === 'absent').length, 2);
  assert.equal(p.data.memorySelection.allMatchesSelected, true);
}));
test('legacy memory parsing is explicit and exact document bytes remain recoverable', () => fixture(f => {
  const original = Buffer.from('\ufeff# Lessons\r\n\r\n### 2026-10-30\r\n- Lesson: T-0001 교훈 🐝 e\u0301\r\n- Tag: safety\r\n\r\nAuthored suffix remains.\r\n');
  f.put('lessons.md', original);
  const p = S.currentPacket(f.root, { includeMemory: true }); bounded(p);
  assert.equal(p.data.memory[0].sourceRef.id, 'memory:lessons:markdown');
  assert.equal(p.data.memory[0].representation, 'parsed-entry-values');
  assert.deepEqual(pages(f.root, p.data.memory[0].sourceRef.id, p.data.memory[0].sourceRef.revision), original);
}));
test('oversized matching memory is omitted whole with an exact source reference', () => fixture(f => {
  const value = [{ title: 'T-0001', decision: '원문🐝e\u0301\r\n'.repeat(2000), reason: '', alternatives: null, impact: null }];
  f.put('decisions.json', value);
  const p = S.currentPacket(f.root, { includeMemory: true }); bounded(p);
  assert.equal(p.complete, false); assert.deepEqual(p.data.memory, []);
  assert(p.missingRequiredIds.includes('memory:decisions:json'));
  const source = p.sourceRevision.selectedSources.find(s => s.id === 'memory:decisions:json');
  assert.deepEqual(pages(f.root, source.id, source.sha256), fs.readFileSync(path.join(f.workspace, 'decisions.json')));
}));
test('canonical corruption never falls back to valid legacy memory', () => fixture(f => {
  f.put('decisions.md', '### 2026-10-30 — T-0001\n- Decision: fallback must not hide corruption\n');
  for (const value of ['{ broken', '{}', '[{"title":5}]', '[["not an item"]]']) {
    f.put('decisions.json', value); assertError(f.root, { includeMemory: true }, 'memory_source_invalid');
  }
}));
test('memory input count and depth admission fail without writing source', () => fixture(f => {
  f.put('lessons.json', Array.from({ length: 10001 }, () => ({ text: 'T-0001' })));
  assertError(f.root, { includeMemory: true }, 'memory_source_limit');
  f.put('lessons.json', '[{"text":"T-0001","extra":' + '['.repeat(65) + '0' + ']'.repeat(65) + '}]');
  assertError(f.root, { includeMemory: true }, 'memory_source_invalid');
}));
test('changed selected memory invalidates captured snapshots and old byte-page revisions', () => fixture(f => {
  f.put('lessons.json', [{ text: 'T-0001 old' }]);
  const snapshot = S.captureSnapshot(f.root, { includeMemory: true }), before = S.renderPacket(snapshot);
  const ref = before.data.memory[0].sourceRef;
  f.put('lessons.json', [{ text: 'T-0001 new' }]);
  assert.throws(() => S.renderPacket(snapshot), { code: 'E_STORE_CHANGED' });
  assert.throws(() => S.exactSource(f.root, { id: ref.id, revision: ref.revision }), { code: 'source_changed' });
  assert.notEqual(S.currentPacket(f.root, { includeMemory: true }).sourceRevision.selectionDigest, before.sourceRevision.selectionDigest);
}));
test('a canonical file appearing after legacy capture invalidates that snapshot', () => fixture(f => {
  f.put('lessons.md', '### 2026-10-30\n- Lesson: T-0001 legacy\n');
  const snapshot = S.captureSnapshot(f.root, { includeMemory: true });
  f.put('lessons.json', [{ text: 'T-0001 canonical' }]);
  assert.throws(() => S.renderPacket(snapshot), { code: 'E_STORE_CHANGED' });
}));
test('memory options reject blank, overlong, contradictory and mistyped inputs', () => fixture(f => {
  for (const args of [{ includeMemory: 'true' }, { memoryQuery: '' }, { memoryQuery: 'a'.repeat(257) },
    { includeMemory: false, memoryQuery: 'T-0001' }, { memoryQuery: 'a\nb' }, { includeMemory: true, unknown: true }]) {
    const p = T.evaluate('packet', { path: f.root, ...args }); bounded(p); assert.equal(p.ok, false);
  }
  const cliResult = f.run(['context', 'packet', '--with-memory', '--with-memory', '--json']);
  assert.equal(cliResult.status, 1); assert.equal(JSON.parse(cliResult.stdout).error.code, 'invalid_arguments');
}));
test('retained task lookup preserves raw row digest, CRLF, escaped pipes and ID', () => fixture(f => {
  const before = S.currentPacket(f.root, { task: 'T-0002' });
  const raw = pages(f.root, before.data.taskSource.id, before.data.taskSource.sha256);
  f.retain(); const files = state(f.root), p = S.currentPacket(f.root, { task: 'T-0002' }); bounded(p);
  assert.equal(p.data.selection, 'explicit-retained-task'); assert.equal(p.data.task.retained, true);
  assert.equal(p.data.taskSource.id, before.data.taskSource.id); assert.equal(p.data.taskSource.sha256, before.data.taskSource.sha256);
  assert.deepEqual(pages(f.root, p.data.taskSource.id, p.data.taskSource.sha256), raw);
  assert(raw.subarray(-2).equals(Buffer.from('\r\n'))); assert.equal(p.measurements.historyBodiesRead, 1);
  assert.equal(S.currentPacket(f.root).data.task.id, 'T-0001'); assert.deepEqual(state(f.root), files);
}));
test('explicit retain, bounded retained reads and restore complete a bytes-exact CLI round trip', () => fixture(f => {
  const before = state(f.root), preview = f.run(['context', 'history', 'preview', '--tasks', 'T-0002', '--json']);
  assert.equal(preview.status, 0, preview.stdout + preview.stderr); assert.deepEqual(state(f.root), before);
  const p = JSON.parse(preview.stdout);
  const applied = f.run(['context', 'history', 'apply', '--tasks', 'T-0002', '--expect', p.expected, '--json']); assert.equal(applied.status, 0, applied.stdout + applied.stderr);
  assert.equal(H.reservedTaskMax(f.root), 2);
  const packet = f.run(['context', 'packet', '--task', 'T-0002', '--json']); assert.equal(packet.status, 0, packet.stdout + packet.stderr);
  const selected = JSON.parse(packet.stdout); bounded(selected); assert.equal(selected.data.task.id, 'T-0002');
  const restorePreview = f.run(['context', 'history', 'preview-restore', '--operation', p.operationId, '--json']);
  assert.equal(restorePreview.status, 0, restorePreview.stdout + restorePreview.stderr);
  const restored = f.run(['context', 'history', 'restore', '--operation', p.operationId, '--expect', JSON.parse(restorePreview.stdout).expected, '--json']);
  assert.equal(restored.status, 0, restored.stdout + restored.stderr);
  assert.deepEqual(fs.readFileSync(f.tracker), f.original); assert.equal(S.currentPacket(f.root, { task: 'T-0002' }).data.selection, 'explicit-task');
  assert.deepEqual(pages(f.root, selected.data.taskSource.id, selected.data.taskSource.sha256), require('../lib/progress-rows').rawProgressRow(f.original, 'T-0002'));
}));
test('new authored work blocks whole-tracker restore instead of overwriting it', () => fixture(f => {
  const op = f.retain(); fs.appendFileSync(f.tracker, 'New authored work must survive.\r\n');
  const before = state(f.root);
  assert.throws(() => W.previewRestore(f.root, op.operationId), { code: 'history_restore_conflict' });
  assert.deepEqual(state(f.root), before); assert.equal(S.currentPacket(f.root, { task: 'T-0002' }).data.task.id, 'T-0002');
}));
test('only the selected retained source body is read even with multiple operations', () => fixture(f => {
  const first = f.retain(['T-0003']); const second = f.retain(['T-0002']);
  const other = path.join(f.workspace, 'archive/history', second.operationId, 'progress-before.md');
  const originalOpen = fs.openSync;
  fs.openSync = function (file) { assert.notEqual(String(file), other, 'Unselected archive body read'); return originalOpen.apply(this, arguments); };
  try {
    const p = S.currentPacket(f.root, { task: 'T-0003' }); bounded(p);
    assert.equal(p.data.task.historyOperationId, first.operationId); assert.equal(p.measurements.historyBodiesRead, 1);
    assert.equal(p.sourceRevision.selectedSources.filter(s => s.id.startsWith('history:T-')).length, 1);
  } finally { fs.openSync = originalOpen; }
}));
test('pending history is incomplete, not a healthy missing task', () => fixture(f => {
  const op = f.retain(); f.put('history-operation.json', { schema: H.OPERATION_SCHEMA, state: 'pending', action: 'retain', operationId: op.operationId, manifest: { operationId: op.operationId } });
  assertError(f.root, { task: 'T-0002' }, 'history_index_incomplete');
}));
test('corrupt or missing selected history index fails closed without affecting ordinary reads', () => fixture(f => {
  f.retain(); const index = path.join(f.workspace, 'archive/history/index.json'); fs.writeFileSync(index, '{ corrupt');
  assertError(f.root, { task: 'T-0002' }, 'history_index_invalid'); assert.equal(S.currentPacket(f.root).data.task.id, 'T-0001');
  fs.unlinkSync(index); assertError(f.root, { task: 'T-0002' }, 'history_index_incomplete');
}));
test('stale index metadata and changed source digest are not silently accepted', () => fixture(f => {
  const op = f.retain(), index = path.join(f.workspace, 'archive/history/index.json');
  fs.unlinkSync(path.join(f.workspace, 'history-operation.json'));
  const value = JSON.parse(fs.readFileSync(index)); value.entries[0].status = 'dropped'; fs.writeFileSync(index, JSON.stringify(value));
  assertError(f.root, { task: 'T-0002' }, 'history_index_stale');
  value.entries[0].status = 'done'; fs.writeFileSync(index, JSON.stringify(value));
  fs.appendFileSync(path.join(f.workspace, 'archive/history', op.operationId, 'progress-before.md'), 'changed');
  assertError(f.root, { task: 'T-0002' }, 'history_source_changed');
}));
test('missing retained source and corrupted operation receipt remain explicit errors', () => fixture(f => {
  const op = f.retain(), dir = path.join(f.workspace, 'archive/history', op.operationId);
  const file = path.join(dir, 'progress-before.md'), bytes = fs.readFileSync(file); fs.unlinkSync(file);
  assertError(f.root, { task: 'T-0002' }, 'history_source_missing');
  fs.writeFileSync(file, bytes); fs.writeFileSync(path.join(dir, 'retain.json'), '{}');
  assertError(f.root, { task: 'T-0002' }, 'history_index_incomplete');
}));
test('metadata changing after capture rejects the same source bytes under a stale snapshot', () => fixture(f => {
  f.retain(); const snapshot = S.captureSnapshot(f.root, { task: 'T-0002' });
  fs.appendFileSync(path.join(f.workspace, 'archive/history/index.json'), '\n');
  assert.throws(() => S.renderPacket(snapshot), { code: 'E_STORE_CHANGED' });
}));
test('retained source hard links are rejected by the existing checked reader', () => fixture(f => {
  const op = f.retain(), file = path.join(f.workspace, 'archive/history', op.operationId, 'progress-before.md');
  fs.linkSync(file, path.join(f.root, 'other-link'));
  assertError(f.root, { task: 'T-0002' }, 'history_source_invalid');
}));
test('symlinked archive ancestor is refused rather than following an external tree', t => fixture(f => {
  f.retain(); const archive = path.join(f.workspace, 'archive'), other = path.join(f.root, 'external'); fs.renameSync(archive, other);
  try { fs.symlinkSync(other, archive, process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) { if (['EPERM', 'EACCES', 'ENOSYS'].includes(error.code)) { t.skip('Platform denied fixture symlink'); return; } throw error; }
  assertError(f.root, { task: 'T-0002' }, 'history_source_invalid');
}));
test('retained task and memory CLI/MCP responses share data and error semantics', () => fixture(f => {
  f.put('lessons.json', [{ text: 'T-0002 retained lesson' }]); f.retain();
  const packet = f.run(['context', 'packet', '--task', 'T-0002', '--with-memory', '--json']); assert.equal(packet.status, 0, packet.stdout + packet.stderr);
  const args = { path: f.root, task: 'T-0002', includeMemory: true };
  const requests = [{ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'leerness_context_packet', arguments: args } },
    { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'leerness_context_source', arguments: { path: f.root, id: 'task:T-0002', revision: '0'.repeat(64) } } }];
  const mcp = f.run(['mcp', 'serve', '--profile', 'core'], { input: requests.map(r => JSON.stringify(r)).join('\n') + '\n' }); assert.equal(mcp.status, 0, mcp.stderr);
  const result = mcp.stdout.trim().split('\n').map(line => JSON.parse(line)); assert.equal(result[0].result.isError, false);
  assert.deepEqual(plain(JSON.parse(packet.stdout)), plain(JSON.parse(result[0].result.content[0].text)));
  assert.equal(result[1].result.isError, true); assert.equal(JSON.parse(result[1].result.content[0].text).error.code, 'source_changed');
}));
test('unknown retained IDs and raw memory IDs cannot become filesystem paths', () => fixture(f => {
  f.retain(); assertError(f.root, { task: 'T-9999' }, 'task_not_found');
  for (const id of ['history:../../outside', 'memory:lessons:../../outside', 'task:../../outside']) {
    const response = T.evaluate('source', { path: f.root, id, revision: '0'.repeat(64) }); bounded(response);
    assert.equal(response.ok, false); assert.equal(response.error.code, 'invalid_source_id');
  }
}));
test('memory and retained CLI/MCP reads have no network attempts or CLI children with OFFLINE unset', () => fixture(f => {
  f.put('lessons.json', [{ text: 'T-0002 exact lesson' }]); f.retain();
  const guard = path.join(f.root, 'guard.cjs'), events = path.join(f.root, 'events.log');
  fs.writeFileSync(guard, `const fs=require('fs'),cp=require('child_process'),path=require('path');
const note=(kind,detail)=>fs.appendFileSync(process.env.MEMORY_EVENTS,JSON.stringify({kind,detail})+'\\n');
for(const name of ['spawnSync','spawn','execSync','exec','execFile','execFileSync','fork']){const original=cp[name];cp[name]=function(file,args){const base=path.basename(String(file)).toLowerCase(),values=Array.isArray(args)?args.map(String):[];note('child',[String(file),...values]);const system=process.env.SystemRoot||process.env.WINDIR;const git=(base==='git'||base==='git.exe')&&values.includes('rev-parse');const where=system&&file===path.join(system,'System32','where.exe')&&values.length===1&&values[0]==='git';const chcp=system&&file===path.join(system,'System32','chcp.com')&&(values.length===0||(values.length===1&&values[0]==='65001'));if(!git&&!where&&!chcp)throw new Error('Unexpected child');return original.apply(this,arguments);};}
const block=name=>()=>{note('network',name);throw new Error('Blocked network');};
if(globalThis.fetch)globalThis.fetch=block('fetch');
for(const [name,methods] of [['http',['get','request']],['https',['get','request']],['net',['connect','createConnection']],['tls',['connect']],['http2',['connect']]])for(const method of methods)require(name)[method]=block(name+'.'+method);
require('net').Socket.prototype.connect=block('socket');require('dgram').Socket.prototype.send=block('udp');require('dgram').Socket.prototype.connect=block('udp-connect');
for(const obj of [require('dns'),require('dns').promises])for(const key of Object.keys(obj))if(/^(lookup|resolve|reverse)/.test(key)&&typeof obj[key]==='function')obj[key]=block('dns');
`);
  const env = { ...f.env, NODE_OPTIONS: '--require=' + JSON.stringify(guard), MEMORY_EVENTS: events };
  assert(!Object.hasOwn(env, 'LEERNESS_OFFLINE'));
  const before = state(f.root);
  const packet = f.run(['context', 'packet', '--task', 'T-0002', '--memory-query', 'exact lesson', '--json'], { env }); assert.equal(packet.status, 0, packet.stderr + packet.stdout);
  const revision = sha(fs.readFileSync(path.join(f.workspace, 'lessons.json')));
  const source = f.run(['context', 'source', '--id', 'memory:lessons:json', '--revision', revision, '--json'], { env }); assert.equal(source.status, 0, source.stderr + source.stdout);
  const request = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'leerness_context_packet', arguments: { path: f.root, task: 'T-0002', includeMemory: true } } };
  const mcp = f.run(['mcp', 'serve', '--profile', 'core'], { env, input: JSON.stringify(request) + '\n' }); assert.equal(mcp.status, 0, mcp.stderr);
  assert.equal(JSON.parse(mcp.stdout).result.isError, false);
  const observed = fs.readFileSync(events, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  assert(!observed.some(e => e.kind === 'network')); assert(!observed.some(e => e.kind === 'child' && e.detail[0] === process.execPath));
  fs.unlinkSync(events); assert.deepEqual(state(f.root), before);
  const control = cp.spawnSync(process.execPath, ['-e', 'try{require("http").get("http://127.0.0.1:9")}catch{}'], { env, encoding: 'utf8', timeout: 5000 });
  assert.equal(control.status, 0); assert(fs.readFileSync(events, 'utf8').includes('"network"'));
}));
