'use strict';

const assert = require('node:assert/strict');
const cp = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const { EventEmitter } = require('node:events');
const os = require('node:os');
const path = require('node:path');
const { INPUT_SCHEMA, probeEndpoint, probePrerequisites } = require('../lib/test-prerequisite-probe');
const { removeTree } = require('./temp-cleanup');

const cli = path.resolve(__dirname, '../bin/leerness.js');
const arena = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-test-prerequisite-'));
let passed = 0;
let failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('PASS ' + name); }
  catch (error) { failed++; console.error('FAIL ' + name + ': ' + error.stack); }
}
function input(port, changes = {}) {
  return { schema: INPUT_SCHEMA,
    endpoints: [{ id: 'emulator', host: '127.0.0.1', port, timeoutMs: 500, ...changes }] };
}
function invoke(value, args = ['test-plan', 'probe', '--stdin', '--json']) {
  return new Promise((resolve, reject) => {
    const child = cp.spawn(process.execPath, [cli, ...args], { cwd: arena,
      stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let stdout = ''; let stderr = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('CLI deadline exceeded')); }, 7000);
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', code => {
      clearTimeout(timer);
      try { resolve({ code, data: JSON.parse(stdout), stderr }); } catch (error) { reject(error); }
    });
    child.stdin.end(typeof value === 'string' ? value : JSON.stringify(value));
  });
}
async function withServer(fn) {
  const server = net.createServer(socket => socket.end());
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  try { return await fn(server.address().port); }
  finally { await new Promise(resolve => server.close(resolve)); }
}
async function main() {
  await test('live loopback listener is transport reachable but not service-ready evidence', async () => {
    await withServer(async port => {
      const result = await probePrerequisites(input(port));
      assert.equal(result.results[0].status, 'tcp-open');
      assert.equal(result.allTcpReachable, true);
      assert.equal(result.serviceReadyVerified, false);
      assert.equal(result.finalGatePassed, false);
      assert.equal(result.evidenceReusable, false);
    });
  });
  await test('closed loopback port reports a refusal without retrying test commands', async () => {
    let closedPort;
    await withServer(async port => { closedPort = port; });
    const result = await probePrerequisites(input(closedPort));
    assert.equal(result.results[0].status, 'connection-refused');
    assert.equal(result.allTcpReachable, false);
  });
  await test('unresponsive connector reaches its deadline and closes the socket', async () => {
    let destroyed = false;
    const result = await probeEndpoint(input(8080, { timeoutMs: 25 }).endpoints[0], () => {
      const socket = new EventEmitter();
      socket.destroy = () => { destroyed = true; };
      return socket;
    });
    assert.equal(result.status, 'timeout');
    assert.equal(result.tcpReachable, false);
    assert.equal(destroyed, true);
    assert.ok(result.elapsedMs >= 20 && result.elapsedMs < 1000);
  });
  await test('CLI probes live loopback and does not bootstrap or change project files', async () => {
    await withServer(async port => {
      const marker = path.join(arena, 'keep.txt'); fs.writeFileSync(marker, 'owner data\n');
      const before = fs.readFileSync(marker);
      const result = await invoke(input(port));
      assert.equal(result.code, 0);
      assert.equal(result.stderr, '');
      assert.equal(result.data.probe.results[0].status, 'tcp-open');
      assert.equal(result.data.probe.serviceReadyVerified, false);
      assert.deepEqual(fs.readFileSync(marker), before);
      assert.equal(fs.existsSync(path.join(arena, '.leerness')), false);
    });
  });
  await test('non-loopback hosts and DNS names are rejected before dialing', async () => {
    for (const host of ['example.com', '8.8.8.8', 'localhost']) {
      const result = await invoke(input(8080, { host }));
      assert.equal(result.code, 2);
      assert.equal(result.data.error.code, 'test_probe_host_not_loopback');
      assert.ok(!JSON.stringify(result.data).includes(host));
    }
  });
  await test('invalid port, excessive timeout, duplicate IDs and extra fields are refused', async () => {
    const cases = [
      [input(0), 'test_probe_port_invalid'],
      [input(8080, { timeoutMs: 2001 }), 'test_probe_timeout_invalid'],
      [{ ...input(8080), endpoints: [input(8080).endpoints[0], input(8081).endpoints[0]] }, 'test_probe_id_duplicate'],
      [input(8080, { command: 'npm test' }), 'test_probe_fields_invalid'],
    ];
    for (const [value, code] of cases) {
      const result = await invoke(value);
      assert.equal(result.code, 2);
      assert.equal(result.data.error.code, code);
    }
  });
  await test('duplicate JSON keys and malformed CLI flags fail without a network result', async () => {
    const raw = JSON.stringify(input(8080)).replace('"schema":', '"schema":"other","schema":');
    const duplicate = await invoke(raw);
    assert.equal(duplicate.code, 2);
    assert.equal(duplicate.data.error.code, 'duplicate_json_key');
    const flag = await invoke(input(8080), ['test-plan', 'probe', '--bad', '--json']);
    assert.equal(flag.code, 2);
    assert.equal(flag.data.error.code, 'invalid_cli_arguments');
  });
  await test('batch input stays bounded to sixteen loopback endpoints', async () => {
    const value = { schema: INPUT_SCHEMA, endpoints: Array.from({ length: 17 }, (_, i) =>
      ({ id: `endpoint-${i}`, host: '127.0.0.1', port: 5000 + i, timeoutMs: 20 })) };
    const result = await invoke(value);
    assert.equal(result.code, 2);
    assert.equal(result.data.error.code, 'test_probe_endpoints_invalid');
  });
}
main().finally(() => {
  const resolved = fs.realpathSync(arena);
  assert.equal(path.dirname(resolved).toLowerCase(), fs.realpathSync(os.tmpdir()).toLowerCase());
  assert.ok(path.basename(resolved).startsWith('leerness-test-prerequisite-'));
  removeTree(resolved, { recursive: true, force: true });
  console.log(`test prerequisite probe: ${passed}/${passed + failed} passed`);
  if (failed) process.exitCode = 1;
});
