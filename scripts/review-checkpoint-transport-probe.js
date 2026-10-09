#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
const crypto = require('node:crypto');
const { PassThrough, Readable, Writable } = require('node:stream');
const adapter = require('../lib/review-checkpoint-transport');
const domain = require('../lib/review-checkpoint');
const { LEGACY_WORKSPACE_DIR } = require('../lib/workspace-dir');
const entry = path.resolve(__dirname, '../bin/leerness.js');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-rb01-transport-'));
const tests = [];
function test(name, run) { tests.push({ name, run }); }
function fixture() {
  return {
    schema: domain.INPUT_SCHEMA,
    objective: { id: 'order-create', criteria: ['order-create-works'] },
    tasks: [{ id: 'order-api', objectiveId: 'order-create', criteria: ['order-create-works'],
      dependsOn: [], implementation: 'implemented', verification: 'passed',
      evidenceRefs: ['evidence:order-api'], risk: 'normal', riskTags: [], aspects: ['code', 'tests'] }],
    context: { event: 'task-report', purposeComplete: true, executionMode: 'direct' },
    snapshot: { kind: 'git', baseCommit: 'a'.repeat(40), headCommit: 'b'.repeat(40) },
    limits: { maxTasks: 5, maxFiles: 10, maxChangedLines: 400, maxWaitingHours: 24 },
    metrics: { fileCount: 2, changedLines: 80, waitingHours: 1 },
  };
}
const text = JSON.stringify(fixture());
function snapshot(dir) {
  const result = {};
  function walk(folder, prefix) {
    for (const name of fs.readdirSync(folder).sort()) {
      const file = path.join(folder, name), relative = prefix + name, stat = fs.lstatSync(file);
      result[relative] = { mode: stat.mode, mtime: stat.mtimeMs, size: stat.isDirectory() ? 0 : stat.size,
        hash: stat.isFile() ? crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') : null,
        link: stat.isSymbolicLink() ? fs.readlinkSync(file) : null };
      if (stat.isDirectory()) walk(file, relative + '/');
    }
  }
  walk(dir, '');
  return result;
}
function command(cwd, args, input, env = {}) {
  const r = cp.spawnSync(process.execPath, [entry, ...args], {
    cwd, input, encoding: 'utf8', timeout: 15000, maxBuffer: 1024 * 1024,
    env: { ...process.env, ...env },
  });
  assert.equal(r.error, undefined, r.error && r.error.message);
  assert.equal(r.signal, null);
  return r;
}
function rpc(cwd, messages, profile = 'full', env = {}) {
  const r = command(cwd, ['mcp', 'serve', '--profile', profile],
    messages.map(m => JSON.stringify(m)).join('\n') + '\n', env);
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
}
function call(id, args) { return { jsonrpc: '2.0', id, method: 'tools/call', params: { name: 'leerness_review_checkpoint', arguments: args } }; }
function assertNoApproval(result) {
  assert.equal(result.ok, true);
  assert.equal(result.advisoryOnly, true);
  assert.equal(result.assessment.sourceTrust, 'caller-supplied');
  assert.equal(result.assessment.effects.approvalGranted, false);
  assert.ok(Object.values(result.assessment.effects).every(v => v === false));
  assert.deepEqual(result.assessment.verification, { snapshotVerified: false, evidenceVerified: false, independentReview: 'not-run' });
}

test('transport equals the existing assessor, without another decision algorithm', () => {
  const r = adapter.assessReviewCheckpointJson(text);
  assert.deepEqual(r.assessment, domain.assessReviewCheckpoint(fixture()));
  assert.equal(r.schema, adapter.RESPONSE_SCHEMA);
  assertNoApproval(r);
});
for (const [name, raw, code] of [
  ['empty', '', 'invalid_json'], ['syntax', '{"PRIVATE_VALUE":', 'invalid_json'],
  ['type', null, 'input_json_required'], ['BOM', '\uFEFF' + text, 'utf8_bom_not_allowed'],
  ['oversized raw bytes', ' '.repeat(65537), 'input_too_large'],
  ['UTF-8 rather than character count', '한'.repeat(22000), 'input_too_large'],
  ['duplicate root key', '{"PRIVATE_KEY":1,"PRIVATE_KEY":2}', 'duplicate_json_key'],
  ['duplicate nested key', '{"a":[{"PRIVATE_KEY":1,"PRIVATE_KEY":2}]}', 'duplicate_json_key'],
  ['escaped-equivalent keys', '{"a":1,"\\u0061":2}', 'duplicate_json_key'],
  ['nested depth cap', '['.repeat(18) + '0' + ']'.repeat(18), 'input_structure_limit'],
  ['array cap', '[' + Array(1001).fill('0').join(',') + ']', 'input_structure_limit'],
  ['inert root required', 'null', 'object_required'],
  ['unknown input field', '{"PRIVATE_KEY":"PRIVATE_VALUE"}', 'unknown_field'],
]) test(name + ' rejected with bounded private-safe error', () => {
  const r = adapter.assessReviewCheckpointJson(raw);
  assert.equal(r.ok, false); assert.equal(r.error.code, code);
  assert.ok(!JSON.stringify(r).includes('PRIVATE_'));
  assert.ok(Buffer.byteLength(JSON.stringify(r)) < 1024);
});
for (const [name, raw] of [
  ['escaped quotes and delimiters', '{"x":"quoted \\\" , } [ \\\\ text"}'],
  ['nested arrays/objects', '{"a":[{},[],1,false,null,{"b":"c"}]}'],
  ['same key in different objects', '[{"a":1},{"a":2}]'],
]) test('raw parser preserves ' + name, () => assert.deepEqual(adapter.parseInputJson(raw), JSON.parse(raw)));

test('whitespace exactly at input cap is allowed', () => {
  const padded = text + ' '.repeat(65536 - Buffer.byteLength(text));
  assert.equal(adapter.assessReviewCheckpointJson(padded).ok, true);
  assert.equal(adapter.assessReviewCheckpointJson(padded + ' ').error.code, 'input_too_large');
});
for (const verification of ['failed', 'partial', 'not-run', 'inconclusive']) test(verification + ' stays unapproved', () => {
  const input = fixture(); input.tasks[0].verification = verification;
  const r = adapter.assessReviewCheckpointJson(JSON.stringify(input));
  assertNoApproval(r); assert.equal(r.assessment.preparation.state, 'needs-evidence');
});
test('early high-risk checkpoint is not a completed review', () => {
  const input = fixture(); input.context.purposeComplete = false; input.tasks[0].risk = 'high';
  const r = adapter.assessReviewCheckpointJson(JSON.stringify(input));
  assertNoApproval(r); assert.equal(r.assessment.checkpoint.earlyReviewSuggested, true);
  assert.equal(r.assessment.preparation.state, 'needs-evidence');
});
test('MCP arguments reject getters without evaluating them', () => {
  let called = false;
  const args = Object.defineProperty({}, 'inputJson', { enumerable: true, get() { called = true; return text; } });
  assert.equal(adapter.mcpResult(args).isError, true); assert.equal(called, false);
});
for (const args of [{}, { inputJson: null }, { inputJson: 123 }, { inputJson: text, path: 'PRIVATE_VALUE' },
  { inputJson: text, _cursor: '0' }, { inputJson: text, approve: true }]) {
  test('MCP strict input envelope ' + tests.length, () => {
    const r = adapter.mcpResult(args); assert.equal(r.isError, true);
    assert.ok(!r.content[0].text.includes('PRIVATE_VALUE'));
  });
}
test('buffer chunks split across a UTF-8 codepoint decode without replacement', async () => {
  const raw = Buffer.from('{"한":1}');
  const result = await adapter.readJsonStdin(Readable.from([raw.subarray(0, 3), raw.subarray(3)]));
  assert.equal(result, raw.toString('utf8'));
});
for (const [name, raw, code] of [
  ['invalid UTF-8', Buffer.from([0xC3, 0x28]), 'invalid_utf8'],
  ['BOM bytes', Buffer.from([0xEF, 0xBB, 0xBF, 0x7B, 0x7D]), 'utf8_bom_not_allowed'],
  ['oversized stream', Buffer.alloc(65537, 32), 'input_too_large'],
]) test(name + ' stream rejected', async () => {
  await assert.rejects(adapter.readJsonStdin(Readable.from([raw])), e => e.code === code);
});
test('input has a bounded total wait', async () => {
  const stream = new PassThrough();
  await assert.rejects(adapter.readJsonStdin(stream, 20), e => e.code === 'stdin_timeout');
  assert.equal(stream.destroyed, true);
});
test('interactive terminal is rejected instead of hanging', async () => {
  const stream = new PassThrough(); stream.isTTY = true;
  await assert.rejects(adapter.readJsonStdin(stream), e => e.code === 'stdin_pipe_required'); stream.destroy();
});
test('broken output is a rejected transport operation, not an uncaught stream error', async () => {
  const output = new Writable({ write(chunk, encoding, callback) { callback(new Error('broken output')); } });
  await assert.rejects(adapter.runCli(['assess', '--stdin'], Readable.from([Buffer.from(text)]), output), /broken output/);
});
test('early stream close is distinguished from complete input', async () => {
  const stream = new PassThrough();
  const result = adapter.readJsonStdin(stream);
  stream.destroy();
  await assert.rejects(result, e => e.code === 'stdin_closed_early');
});
test('large MCP responses remain one complete JSON document', () => {
  const input = fixture();
  input.objective.criteria = Array.from({ length: 100 }, (_, i) => 'crit' + String(i).padStart(4, '0'));
  input.tasks = Array.from({ length: 45 }, (_, i) => ({ ...input.tasks[0], id: 'task' + i, criteria: [...input.objective.criteria] }));
  input.limits.maxTasks = 100;
  const raw = JSON.stringify(input);
  assert.ok(Buffer.byteLength(raw) <= 65536);
  const response = adapter.mcpResult({ inputJson: raw });
  assert.equal(response.isError, false);
  assert.ok(response.content[0].text.length > 50000);
  assert.ok(Buffer.byteLength(response.content[0].text) <= adapter.MAX_OUTPUT_BYTES);
  assertNoApproval(JSON.parse(response.content[0].text));
  const actual = rpc(empty, [call(1, { inputJson: raw })])[0].result;
  assert.deepEqual(actual, response);
});
test('actual stdin accepts the maximum raw input byte length', () => {
  const padded = text + ' '.repeat(65536 - Buffer.byteLength(text));
  const r = command(empty, ['review-checkpoint', 'assess', '--stdin'], padded);
  assert.equal(r.status, 0, r.stderr); assertNoApproval(JSON.parse(r.stdout));
});
test('file snapshot guard detects same-size mutation (negative control)', () => {
  const dir = path.join(root, 'negative-control'); fs.mkdirSync(dir);
  const file = path.join(dir, 'canary'); fs.writeFileSync(file, 'one');
  const before = snapshot(dir); fs.writeFileSync(file, 'two'); assert.notDeepEqual(snapshot(dir), before);
});

const current = path.join(root, 'current');
const legacy = path.join(root, 'legacy');
const empty = path.join(root, 'empty');
for (const dir of [current, legacy, empty]) fs.mkdirSync(dir);
for (const [dir, name] of [[current, '.leerness'], [legacy, LEGACY_WORKSPACE_DIR]]) {
  const state = path.join(dir, name); fs.mkdirSync(state);
  fs.writeFileSync(path.join(state, 'current-state.md'), 'Keep original state.\n');
  fs.writeFileSync(path.join(state, 'config.json'), '{}\n');
  fs.writeFileSync(path.join(state, 'usage-stats.json'), '{"canary":true}\n');
  fs.writeFileSync(path.join(state, 'decisions.json'), 'not valid JSON, must remain untouched');
}
for (const cwd of [current, legacy, empty]) {
  test('actual CLI success and failures write nothing in ' + path.basename(cwd), () => {
    const before = snapshot(cwd);
    const good = command(cwd, ['review-checkpoint', 'assess', '--stdin', '--json'], text);
    assert.equal(good.status, 0, good.stderr); assert.equal(good.stderr, '');
    assertNoApproval(JSON.parse(good.stdout));
    for (const [args, raw] of [
      [['assess', '--stdin'], '{"x":1,"x":2}'], [['assess', '--stdin'], Buffer.from([0xFF])],
      [['assess', '--stdin'], Buffer.alloc(65537, 32)], [['assess'], text],
      [['assess', '--stdin', '--apply'], text], [['assess', '--stdin', '--stdin'], text],
      [['assess', '--stdin', '--path', 'never-create'], text], [['assess', 'packet.json'], text],
    ]) {
      const bad = command(cwd, ['review-checkpoint', ...args], raw);
      assert.equal(bad.status, 2, bad.stderr); assert.equal(JSON.parse(bad.stdout).ok, false);
    }
    assert.deepEqual(snapshot(cwd), before);
  });
  test('actual MCP calls write nothing in ' + path.basename(cwd), () => {
    const before = snapshot(cwd);
    const replies = rpc(cwd, [
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      call(2, { inputJson: text }), call(3, { inputJson: '{"x":1,"x":2}' }),
      call(4, { inputJson: text, PRIVATE_KEY: 'PRIVATE_VALUE' }), call(5, { inputJson: text }),
    ]);
    assert.equal(replies.length, 5);
    assertNoApproval(JSON.parse(replies.find(r => r.id === 2).result.content[0].text));
    assert.equal(replies.find(r => r.id === 3).result.isError, true);
    assert.equal(replies.find(r => r.id === 4).result.isError, true);
    assert.ok(!JSON.stringify(replies).includes('PRIVATE_'));
    assert.deepEqual(replies.find(r => r.id === 2).result, replies.find(r => r.id === 5).result);
    assert.deepEqual(snapshot(cwd), before);
  });
}
test('MCP full advertises the exact input; core cannot call a hidden tool', () => {
  const listed = rpc(empty, [{ jsonrpc: '2.0', id: 1, method: 'tools/list' }]);
  const tool = listed[0].result.tools.find(t => t.name === 'leerness_review_checkpoint');
  assert.equal(tool.requiredTier, 'read-only'); assert.equal(tool.inputSchema.additionalProperties, false);
  assert.deepEqual(tool.inputSchema.required, ['inputJson']);
  const denied = rpc(empty, [call(2, { inputJson: text })], 'core');
  assert.equal(denied[0].error.code, -32601);
});
test('CLI help is discoverable and does not read stdin', () => {
  const r = command(empty, ['review-checkpoint', '--help'], '');
  assert.equal(r.status, 0); assert.ok(r.stdout.includes('assess --stdin'));
});
test('CLI is side-effect-free even with process/filesystem write tripwires', () => {
  const guard = path.join(root, 'guard.cjs');
  fs.writeFileSync(guard, "const fs=require('node:fs'),cp=require('node:child_process');\n"
    + "for(const k of ['writeFileSync','appendFileSync','mkdirSync','renameSync','unlinkSync','rmSync','writeFile','appendFile','mkdir','rename','unlink','rm'])fs[k]=()=>{throw Error('unexpected file write')};\n"
    + "for(const k of ['spawn','spawnSync','exec','execSync','execFile','execFileSync','fork'])cp[k]=()=>{throw Error('unexpected child process')};\n");
  const before = snapshot(current);
  const r = cp.spawnSync(process.execPath, ['--require', guard, entry, 'review-checkpoint', 'assess', '--stdin'],
    { cwd: current, input: text, encoding: 'utf8', timeout: 10000 });
  assert.equal(r.status, 0, r.stderr); assertNoApproval(JSON.parse(r.stdout));
  assert.deepEqual(snapshot(current), before);
});

// Transport closure: exercise the remaining stream and real stdio RPC paths.
test('raw parser bounds total values even when each array is within its limit', () => {
  const raw = JSON.stringify(Array.from({ length: 10 }, () => Array(1000).fill(0)));
  assert.ok(Buffer.byteLength(raw) < domain.MAX_BYTES);
  const response = adapter.assessReviewCheckpointJson(raw);
  assert.equal(response.ok, false);
  assert.equal(response.error.code, 'input_structure_limit');
});
test('text-mode stdin is rejected rather than silently re-encoded', async () => {
  const stream = Readable.from(['{}']);
  await assert.rejects(adapter.readJsonStdin(stream), error => error.code === 'stdin_binary_required');
  assert.equal(stream.destroyed, true);
});
test('stdin I/O errors produce a private-safe CLI failure response', async () => {
  const input = new Readable({ read() { this.destroy(new Error('PRIVATE_INPUT_FAILURE')); } });
  const chunks = [];
  const output = new Writable({ write(chunk, encoding, callback) { chunks.push(Buffer.from(chunk)); callback(); } });
  const status = await adapter.runCli(['assess', '--stdin'], input, output);
  const raw = Buffer.concat(chunks).toString('utf8');
  const response = JSON.parse(raw);
  assert.equal(status, 2);
  assert.equal(response.ok, false);
  assert.equal(response.error.code, 'stdin_read_failed');
  assert.equal(response.advisoryOnly, true);
  assert.ok(!raw.includes('PRIVATE_'));
  assert.equal(input.destroyed, true);
});
test('rejected duplicate flags never consume stdin', async () => {
  let consumed = false;
  const input = new Readable({ read() { consumed = true; this.push(null); } });
  const chunks = [];
  const output = new Writable({ write(chunk, encoding, callback) { chunks.push(Buffer.from(chunk)); callback(); } });
  try {
    const status = await adapter.runCli(['assess', '--stdin', '--json', '--json'], input, output);
    assert.equal(status, 2);
    assert.equal(consumed, false);
    assert.equal(JSON.parse(Buffer.concat(chunks).toString('utf8')).error.code, 'invalid_cli_arguments');
  } finally { input.destroy(); }
});
test('actual MCP tool notifications have no reply, including rejected input', () => {
  const good = call(1, { inputJson: text }); delete good.id;
  const bad = call(2, { inputJson: '{' }); delete bad.id;
  const before = snapshot(empty);
  const replies = rpc(empty, [good, bad, call(3, { inputJson: text })]);
  assert.equal(replies.length, 1);
  assert.equal(replies[0].id, 3);
  assertNoApproval(JSON.parse(replies[0].result.content[0].text));
  assert.deepEqual(snapshot(empty), before);
});
test('actual MCP invalid outer arguments remain failures without leaking values', () => {
  const inputs = [[], 'PRIVATE_VALUE', true, { inputJson: text, path: 'PRIVATE_VALUE' }, undefined, null];
  const before = snapshot(empty);
  const replies = rpc(empty, inputs.map((args, i) => call(i + 1, args)));
  assert.equal(replies.length, inputs.length);
  replies.forEach((reply, i) => {
    assert.equal(reply.id, i + 1);
    if (reply.error) assert.equal(reply.error.code, -32602);
    else {
      assert.equal(reply.result.isError, true);
      const response = JSON.parse(reply.result.content[0].text);
      assert.equal(response.ok, false);
      assert.equal(response.advisoryOnly, true);
    }
  });
  assert.ok(!JSON.stringify(replies).includes('PRIVATE_'));
  assert.deepEqual(snapshot(empty), before);
});
test('actual MCP drains multiple pipe-sized replies and an unterminated final request', () => {
  const before = snapshot(empty);
  const messages = Array.from({ length: 100 }, (_, i) => call(i + 1, { inputJson: text }));
  // Deliberately omit the final newline; EOF must process the last request and
  // flush every queued response, not only the first pipe-buffer-sized prefix.
  const result = command(empty, ['mcp', 'serve', '--profile', 'full'], messages.map(m => JSON.stringify(m)).join('\n'));
  assert.equal(result.status, 0, result.stderr);
  assert.ok(Buffer.byteLength(result.stdout) > 65536);
  const replies = result.stdout.trim().split('\n').map(line => JSON.parse(line));
  const expected = adapter.mcpResult({ inputJson: text });
  assert.equal(replies.length, messages.length);
  replies.forEach((reply, i) => { assert.equal(reply.id, i + 1); assert.deepEqual(reply.result, expected); });
  assert.deepEqual(snapshot(empty), before);
});

(async () => {
  let passed = 0;
  try {
    for (const t of tests) {
      try { await t.run(); passed++; console.log('PASS ' + t.name); }
      catch (error) { console.error('FAIL ' + t.name + '\n' + error.stack); }
    }
    console.log(`review-checkpoint transport: ${passed}/${tests.length} passed; Node ${process.version}; ${process.platform}`);
    if (passed !== tests.length) process.exitCode = 1;
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
})();
