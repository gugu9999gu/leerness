#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
const crypto = require('node:crypto');
const { Readable, Writable, PassThrough } = require('node:stream');
const adapter = require('../lib/review-snapshot-transport');
const domain = require('../lib/review-snapshot');
const { LEGACY_WORKSPACE_DIR } = require('../lib/workspace-dir');
const { removeTree } = require('./temp-cleanup');
const entry = path.resolve(__dirname, '../bin/leerness.js');
const tests = [];
const test = (name, run) => tests.push({ name, run });
const digest = c => 'sha256:' + c.repeat(64);
function fixture() {
  return {
    schema: domain.INPUT_SCHEMA,
    batch: { id: 'RB-02', revision: 1, objectiveRevision: 'acceptance-1', policyRevision: 'policy-1' },
    materials: { schema: domain.MATERIAL_SCHEMA, manifestDigest: digest('1'), acceptanceDigest: digest('2'),
      policyDigest: digest('3'), evidenceDigest: digest('4'), implementationDigest: digest('5'), dependenciesDigest: digest('6') },
    checkpoint: {
      schema: 'leerness.review-checkpoint-input/v1',
      objective: { id: 'O-order', criteria: ['C-api'] },
      context: { event: 'task-report', purposeComplete: true, executionMode: 'direct' },
      snapshot: { kind: 'git', baseCommit: 'a'.repeat(40), headCommit: 'b'.repeat(40) },
      limits: { maxTasks: 5, maxFiles: 10, maxChangedLines: 400, maxWaitingHours: 24 },
      metrics: { fileCount: 2, changedLines: 80, waitingHours: 1 },
      tasks: [{ id: 'T-api', objectiveId: 'O-order', criteria: ['C-api'], dependsOn: [],
        implementation: 'implemented', verification: 'passed', evidenceRefs: ['E-unit'],
        risk: 'normal', riskTags: [], aspects: ['code', 'tests'] }],
      externalDependencies: []
    }
  };
}
const text = JSON.stringify(fixture());
const pairText = JSON.stringify({ previous: fixture(), current: fixture() });
function noApproval(response) {
  assert.equal(response.schema, adapter.RESPONSE_SCHEMA);
  assert.equal(response.ok, true);
  assert.equal(response.advisoryOnly, true);
  assert.equal(response.result.approvalReusable, false);
  assert.equal(response.result.sourceTrust, 'caller-supplied');
  assert.equal(response.result.durability, 'not-persisted');
  assert.ok(Object.values(response.result.effects).every(value => value === false));
  if (response.operation === 'candidate') {
    assert.equal(response.result.verification.reviewStatus, 'not-evaluated');
    for (const [key, value] of Object.entries(response.result.verification)) if (key !== 'reviewStatus') assert.equal(value, false);
  } else assert.equal(response.result.reviewValidity, 'unverified');
}
function snapshot(dir) {
  const records = {};
  function walk(folder, prefix) {
    for (const name of fs.readdirSync(folder).sort()) {
      const file = path.join(folder, name), relative = prefix + name, st = fs.lstatSync(file);
      records[relative] = { mode: st.mode, mtime: st.mtimeMs, size: st.isDirectory() ? 0 : st.size,
        hash: st.isFile() ? crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') : null,
        link: st.isSymbolicLink() ? fs.readlinkSync(file) : null };
      if (st.isDirectory()) walk(file, relative + '/');
    }
  }
  walk(dir, '');
  return records;
}
function command(cwd, args, input, prefix = []) {
  const result = cp.spawnSync(process.execPath, [...prefix, entry, ...args], {
    cwd, input, encoding: 'utf8', timeout: 20000, maxBuffer: 1024 * 1024,
    env: { ...process.env, LEERNESS_NO_AUTOCHCP: '1' }, windowsHide: true
  });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.signal, null);
  return result;
}
function call(id, args) {
  return { jsonrpc: '2.0', id, method: 'tools/call', params: { name: 'leerness_review_snapshot', arguments: args } };
}
function rpc(cwd, messages, profile = 'full') {
  const result = command(cwd, ['mcp', 'serve', '--profile', profile], messages.map(m => JSON.stringify(m)).join('\n') + '\n');
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
}

test('candidate transport equals existing pure contract', () => {
  const result = adapter.evaluateSnapshotJson('candidate', text);
  noApproval(result);
  assert.deepEqual(result.result, domain.createReviewSnapshotCandidate(text));
});
test('comparison transport equals existing pure contract', () => {
  const result = adapter.evaluateSnapshotJson('compare', pairText);
  noApproval(result);
  assert.deepEqual(result.result, domain.compareReviewSnapshotInputs(text, text));
  assert.equal(result.result.bindingState, 'unchanged');
});
for (const [name, mutate, reason] of [
  ['batch', v => { v.batch.revision++; }, 'batch-changed'],
  ['source', v => { v.checkpoint.snapshot.headCommit = 'c'.repeat(40); }, 'source-changed'],
  ['manifest', v => { v.materials.manifestDigest = digest('0'); }, 'manifest-changed'],
  ['acceptance', v => { v.materials.acceptanceDigest = digest('0'); }, 'acceptance-changed'],
  ['policy', v => { v.materials.policyDigest = digest('0'); }, 'policy-changed'],
  ['tasks', v => { v.checkpoint.tasks[0].verification = 'failed'; }, 'tasks-changed'],
  ['evidence', v => { v.materials.evidenceDigest = digest('0'); }, 'evidence-changed'],
  ['attempts', v => { v.materials.implementationDigest = digest('0'); }, 'implementation-attempts-changed'],
  ['dependencies', v => { v.materials.dependenciesDigest = digest('0'); }, 'dependencies-changed']
]) test(name + ' change is reported without reusable approval', () => {
  const current = fixture(); mutate(current);
  const result = adapter.evaluateSnapshotJson('compare', JSON.stringify({ previous: fixture(), current }));
  noApproval(result);
  assert.equal(result.result.bindingState, 'changed');
  assert.deepEqual(result.result.reasonCodes, [reason]);
});
for (const verification of ['failed', 'partial', 'not-run', 'inconclusive']) test(verification + ' remains unverified', () => {
  const input = fixture(); input.checkpoint.tasks[0].verification = verification;
  noApproval(adapter.evaluateSnapshotJson('candidate', JSON.stringify(input)));
});
for (const [name, input, code] of [
  ['empty', '', 'invalid_json'], ['malformed', '{"PRIVATE_MARKER":', 'invalid_json'],
  ['non-string', null, 'input_json_required'], ['BOM', '\uFEFF' + text, 'utf8_bom_not_allowed'],
  ['oversize', ' '.repeat(65537), 'input_too_large'], ['UTF-8 byte count', '한'.repeat(22000), 'input_too_large'],
  ['root duplicate', '{"PRIVATE_MARKER":1,"PRIVATE_MARKER":2}', 'duplicate_json_key'],
  ['nested duplicate', '{"previous":{"a":1,"a":2}}', 'duplicate_json_key'],
  ['escaped duplicate', '{"a":1,"\\u0061":2}', 'duplicate_json_key'],
  ['depth', '['.repeat(18) + '0' + ']'.repeat(18), 'input_structure_limit'],
  ['array count', '[' + Array(1001).fill('0').join(',') + ']', 'input_structure_limit'],
  ['null root', 'null', 'object_required'], ['unknown field', '{"PRIVATE_MARKER":1}', 'unknown_field']
]) test(name + ' receives bounded private-safe error', () => {
  const result = adapter.evaluateSnapshotJson('candidate', input);
  assert.equal(result.ok, false); assert.equal(result.error.code, code);
  assert.ok(!JSON.stringify(result).includes('PRIVATE_MARKER'));
  assert.ok(Buffer.byteLength(JSON.stringify(result)) < 1024);
});
for (const value of [null, [], {}, { previous: fixture() }, { current: fixture() },
  { previous: fixture(), current: fixture(), approved: true }, { previous: null, current: fixture() }]) {
  test('strict comparison envelope ' + tests.length, () => assert.equal(adapter.evaluateSnapshotJson('compare', JSON.stringify(value)).ok, false));
}
test('fabricated prior candidate is not an input or approval receipt', () => {
  const previous = domain.createReviewSnapshotCandidate(text);
  assert.equal(adapter.evaluateSnapshotJson('compare', JSON.stringify({ previous, current: fixture() })).ok, false);
});
test('invalid operation never evaluates input', () => assert.equal(adapter.evaluateSnapshotJson('approve', text).error.code, 'invalid_operation'));
for (const [operation, input] of [['candidate', text], ['compare', pairText]]) test(operation + ' applies the cap to the whole document', () => {
  const padded = input + ' '.repeat(65536 - Buffer.byteLength(input));
  noApproval(adapter.evaluateSnapshotJson(operation, padded));
  assert.equal(adapter.evaluateSnapshotJson(operation, padded + ' ').error.code, 'input_too_large');
});
test('MCP descriptors are read without invoking argument getters', () => {
  for (const key of ['operation', 'inputJson']) {
    let called = 0;
    const args = { operation: 'candidate', inputJson: text };
    Object.defineProperty(args, key, { enumerable: true, get() { called++; throw Error('unexpected getter'); } });
    assert.equal(adapter.mcpResult(args).isError, true); assert.equal(called, 0);
  }
});
for (const args of [null, [], {}, { operation: 'candidate' }, { inputJson: text },
  { operation: 'approve', inputJson: text }, { operation: 'candidate', inputJson: 1 },
  { operation: 'candidate', inputJson: text, path: 'PRIVATE_MARKER' },
  { operation: 'candidate', inputJson: text, _cursor: '0' },
  { operation: 'candidate', inputJson: text, approved: true }]) {
  test('MCP rejects invalid envelope ' + tests.length, () => {
    const result = adapter.mcpResult(args); assert.equal(result.isError, true);
    assert.ok(!result.content[0].text.includes('PRIVATE_MARKER'));
  });
}
test('unknown symbol argument is rejected', () => {
  const args = { operation: 'candidate', inputJson: text, [Symbol('extra')]: true };
  assert.equal(adapter.mcpResult(args).isError, true);
});
test('broken output rejects without uncaught stream errors', async () => {
  const output = new Writable({ write(chunk, encoding, done) { done(new Error('broken output')); } });
  await assert.rejects(adapter.runCli(['candidate', '--stdin'], Readable.from([Buffer.from(text)]), output), /broken output/);
});
test('TTY is rejected with a structured response', async () => {
  const input = new PassThrough(); input.isTTY = true;
  let output = '';
  const sink = new Writable({ write(chunk, encoding, done) { output += chunk.toString(); done(); } });
  try {
    assert.equal(await adapter.runCli(['candidate', '--stdin'], input, sink), 2);
    assert.equal(JSON.parse(output).error.code, 'stdin_pipe_required');
  } finally { input.destroy(); }
});

let root;
(async () => {
  let passed = 0;
  try {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-rb02-transport-'));
    const current = path.join(root, 'current'), legacy = path.join(root, 'legacy'), empty = path.join(root, 'empty');
    for (const dir of [current, legacy, empty]) fs.mkdirSync(dir);
    for (const [dir, name] of [[current, '.leerness'], [legacy, LEGACY_WORKSPACE_DIR]]) {
      const state = path.join(dir, name); fs.mkdirSync(state);
      fs.writeFileSync(path.join(state, 'current-state.md'), 'Keep original user text.\r\n');
      fs.writeFileSync(path.join(state, 'config.json'), '{}\n');
      fs.writeFileSync(path.join(state, 'usage-stats.json'), '{"canary":true}\n');
      fs.writeFileSync(path.join(state, 'decisions.json'), 'invalid JSON; no migration or repair');
    }
    test('file snapshot detects same-size content changes', () => {
      const dir = path.join(root, 'control'); fs.mkdirSync(dir);
      const file = path.join(dir, 'canary'); fs.writeFileSync(file, 'one');
      const before = snapshot(dir); fs.writeFileSync(file, 'two'); assert.notDeepEqual(snapshot(dir), before);
    });
    for (const cwd of [current, legacy, empty]) {
      for (const [operation, input] of [['candidate', text], ['compare', pairText]]) {
        test('actual CLI ' + operation + ' does not write in ' + path.basename(cwd), () => {
          const before = snapshot(cwd);
          const good = command(cwd, ['review-snapshot', operation, '--stdin', '--json'], input);
          assert.equal(good.status, 0, good.stderr); assert.equal(good.stderr, '');
          noApproval(JSON.parse(good.stdout));
          for (const [args, raw, code] of [
            [[operation, '--stdin'], '{"a":1,"a":2}', 'duplicate_json_key'],
            [[operation, '--stdin'], Buffer.from([0xff]), 'invalid_utf8'],
            [[operation, '--stdin'], Buffer.from([0xef, 0xbb, 0xbf, 0x7b, 0x7d]), 'utf8_bom_not_allowed'],
            [[operation, '--stdin'], Buffer.alloc(65537, 32), 'input_too_large'],
            [[operation], input, 'invalid_cli_arguments'],
            [[operation, '--stdin', '--apply'], input, 'invalid_cli_arguments'],
            [[operation, '--stdin', '--stdin'], input, 'invalid_cli_arguments'],
            [[operation, '--stdin', '--path', 'never-create'], input, 'invalid_cli_arguments']
          ]) {
            const bad = command(cwd, ['review-snapshot', ...args], raw);
            assert.equal(bad.status, 2, bad.stderr); assert.equal(bad.stderr, '');
            assert.equal(JSON.parse(bad.stdout).error.code, code);
          }
          assert.deepEqual(snapshot(cwd), before);
        });
      }
      test('actual MCP success, rejection and repeat leave ' + path.basename(cwd) + ' unchanged', () => {
        const before = snapshot(cwd);
        const replies = rpc(cwd, [
          { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
          { jsonrpc: '2.0', method: 'notifications/initialized' },
          call(2, { operation: 'candidate', inputJson: text }),
          call(3, { operation: 'compare', inputJson: pairText }),
          call(4, { operation: 'candidate', inputJson: '{"a":1,"a":2}' }),
          call(5, { operation: 'candidate', inputJson: text, path: 'PRIVATE_MARKER' }),
          call(6, { operation: 'candidate', inputJson: text })
        ]);
        assert.equal(replies.length, 6);
        const result = id => replies.find(r => r.id === id).result;
        noApproval(JSON.parse(result(2).content[0].text)); noApproval(JSON.parse(result(3).content[0].text));
        assert.equal(result(4).isError, true); assert.equal(result(5).isError, true);
        assert.deepEqual(result(2), result(6));
        assert.ok(!JSON.stringify(replies).includes('PRIVATE_MARKER'));
        assert.deepEqual(snapshot(cwd), before);
      });
    }
    test('MCP full advertises strict read-only contract and core refuses it', () => {
      const listed = rpc(empty, [{ jsonrpc: '2.0', id: 1, method: 'tools/list' }])[0].result.tools;
      const tool = listed.find(t => t.name === 'leerness_review_snapshot');
      assert.equal(tool.requiredTier, 'read-only');
      assert.equal(tool.inputSchema.additionalProperties, false);
      assert.deepEqual(tool.inputSchema.required, ['operation', 'inputJson']);
      assert.deepEqual(tool.inputSchema.properties.operation.enum, ['candidate', 'compare']);
      assert.equal(rpc(empty, [call(2, { operation: 'candidate', inputJson: text })], 'core')[0].error.code, -32601);
    });
    test('CLI accepts the maximum whole-document stdin size', () => {
      const padded = pairText + ' '.repeat(65536 - Buffer.byteLength(pairText));
      const result = command(empty, ['review-snapshot', 'compare', '--stdin'], padded);
      assert.equal(result.status, 0, result.stderr); noApproval(JSON.parse(result.stdout));
    });
    test('help does not consume input or initialize a project', () => {
      const before = snapshot(empty);
      for (const flag of ['--help', '-h']) {
        const result = command(empty, ['review-snapshot', flag], '');
        assert.equal(result.status, 0); assert.ok(result.stdout.includes('candidate|compare --stdin'));
      }
      assert.deepEqual(snapshot(empty), before);
    });
    test('CLI rejects file/process/network effects with active tripwires', () => {
      const guard = path.join(root, 'guard.cjs');
      fs.writeFileSync(guard, "let attempts=0;const deny=()=>{attempts++;throw Error('unexpected effect')};\n"
        + "const fs=require('node:fs'),cp=require('node:child_process');\n"
        + "for(const k of ['writeFileSync','appendFileSync','mkdirSync','renameSync','unlinkSync','rmSync','writeFile','appendFile','mkdir','rename','unlink','rm'])fs[k]=deny;\n"
        + "for(const k of ['spawn','spawnSync','exec','execSync','execFile','execFileSync','fork'])cp[k]=deny;\n"
        + "for(const name of ['node:http','node:https']){const mod=require(name);mod.request=deny;mod.get=deny;}\n"
        + "process.on('exit',()=>{if(attempts)process.exitCode=91});\n");
      const before = snapshot(current);
      for (const [operation, input] of [['candidate', text], ['compare', pairText]]) {
        const result = command(current, ['review-snapshot', operation, '--stdin'], input, ['--require', guard]);
        assert.equal(result.status, 0, result.stderr); noApproval(JSON.parse(result.stdout));
      }
      assert.deepEqual(snapshot(current), before);
    });
    test('all npm script node entrypoints exist and manifest has no merge markers', () => {
      const pkgText = fs.readFileSync(path.resolve(__dirname, '../package.json'), 'utf8');
      assert.ok(!/^(?:<<<<<<<|=======|>>>>>>>)/m.test(pkgText));
      const pkg = JSON.parse(pkgText);
      // Validation only: this reads each script's command text and runs none of them. Iterating over the
      // script names here made the orphan-guard detector (lib/pure-utils.js) read this live probe as a
      // runner that executes every script, which marked every guard in this repository as live, including
      // the dormant one the e2e self-check plants (T-0314). The values carry everything this check needs.
      for (const value of Object.values(pkg.scripts)) {
        for (const match of value.matchAll(/node\s+(\.\/[\w./-]+\.js)/g)) {
          assert.ok(fs.existsSync(path.resolve(__dirname, '..', match[1])), value + ': ' + match[1]);
        }
      }
    });
    for (const item of tests) {
      try { await item.run(); passed++; console.log('PASS ' + item.name); }
      catch (error) { console.error('FAIL ' + item.name + '\n' + error.stack); }
    }
    console.log(JSON.stringify({ suite: 'review-snapshot-transport', passed, total: tests.length, failed: tests.length - passed, node: process.version, platform: process.platform }));
    if (passed !== tests.length) process.exitCode = 1;
  } finally { if (root) removeTree(root, { recursive: true, force: true }); }
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
