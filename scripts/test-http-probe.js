'use strict';

const assert = require('node:assert/strict');
const cp = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { INPUT_SCHEMA, probeHttpPrerequisites } = require('../lib/test-http-probe');
const { removeTree } = require('./temp-cleanup');

const cli = path.resolve(__dirname, '../bin/leerness.js');
const arena = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-test-http-'));
let passed = 0;
let failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('PASS ' + name); }
  catch (error) { failed++; console.error('FAIL ' + name + ': ' + error.stack); }
}
function input(port, changes = {}) {
  return { schema: INPUT_SCHEMA, endpoints: [{ id: 'service', host: '127.0.0.1', port,
    path: '/health', expectedStatus: 200, bodyIncludes: 'ready', timeoutMs: 500, ...changes }] };
}
function invoke(value, args = ['test-plan', 'http-probe', '--stdin', '--json']) {
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
async function withServer(handler, fn) {
  const server = http.createServer(handler);
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  try { return await fn(server.address().port); }
  finally { await new Promise(resolve => server.close(resolve)); }
}
async function main() {
  await test('HTTP status and body marker match without claiming service or test success', async () => {
    await withServer((request, response) => {
      assert.equal(request.method, 'GET');
      assert.equal(request.url, '/health');
      response.writeHead(200).end('service ready');
    }, async port => {
      const result = await probeHttpPrerequisites(input(port));
      assert.equal(result.results[0].status, 'http-expected');
      assert.equal(result.results[0].observedStatus, 200);
      assert.equal(result.allHttpExpectationsMet, true);
      assert.equal(result.serviceReadyVerified, false);
      assert.equal(result.finalGatePassed, false);
      assert.equal(result.evidenceReusable, false);
    });
  });
  await test('open HTTP port with wrong status or body is not a readiness match', async () => {
    await withServer((request, response) => response.writeHead(503).end('ready'), async port => {
      const result = await probeHttpPrerequisites(input(port));
      assert.equal(result.results[0].status, 'http-status-mismatch');
      assert.equal(result.results[0].httpResponseObserved, true);
      assert.equal(result.results[0].httpExpectationMet, false);
    });
    await withServer((request, response) => response.writeHead(200).end('wrong service'), async port => {
      const result = await probeHttpPrerequisites(input(port));
      assert.equal(result.results[0].status, 'http-body-mismatch');
      assert.equal(result.allHttpExpectationsMet, false);
    });
  });
  await test('redirects are not followed and oversized bodies are rejected', async () => {
    let hits = 0;
    await withServer((request, response) => {
      hits++;
      response.writeHead(302, { location: 'http://example.invalid/health' }).end();
    }, async port => {
      const result = await probeHttpPrerequisites(input(port));
      assert.equal(result.results[0].status, 'http-status-mismatch');
      assert.equal(result.results[0].observedStatus, 302);
      assert.equal(hits, 1);
    });
    await withServer((request, response) => response.writeHead(200).end('x'.repeat(17000) + 'ready'), async port => {
      const result = await probeHttpPrerequisites(input(port));
      assert.equal(result.results[0].status, 'http-response-too-large');
    });
  });
  await test('bounded deadline and closed port report unready without executing a test', async () => {
    await withServer(() => {}, async port => {
      const result = await probeHttpPrerequisites(input(port, { timeoutMs: 30 }));
      assert.equal(result.results[0].status, 'timeout');
      assert.ok(result.results[0].elapsedMs >= 20 && result.results[0].elapsedMs < 1000);
    });
    let closedPort;
    await withServer((request, response) => response.end(), async port => { closedPort = port; });
    const closed = await probeHttpPrerequisites(input(closedPort));
    assert.equal(closed.results[0].status, 'connection-refused');
  });
  await test('status-only expectation can check a deliberately empty 204 response', async () => {
    await withServer((request, response) => response.writeHead(204).end(), async port => {
      const result = await probeHttpPrerequisites(input(port, { expectedStatus: 204, bodyIncludes: null }));
      assert.equal(result.results[0].status, 'http-expected');
    });
  });
  await test('CLI observes local response without creating project state or echoing marker', async () => {
    await withServer((request, response) => response.writeHead(200).end('private-marker ready'), async port => {
      const marker = path.join(arena, 'keep.txt'); fs.writeFileSync(marker, 'owner data\n');
      const before = fs.readFileSync(marker);
      const result = await invoke(input(port, { bodyIncludes: 'private-marker' }));
      assert.equal(result.code, 0);
      assert.equal(result.stderr, '');
      assert.equal(result.data.probe.results[0].status, 'http-expected');
      assert.ok(!JSON.stringify(result.data).includes('private-marker'));
      assert.deepEqual(fs.readFileSync(marker), before);
      assert.equal(fs.existsSync(path.join(arena, '.leerness')), false);
    });
  });
  await test('external host, URL-like path, query and traversal are rejected before dial', async () => {
    for (const changes of [{ host: 'localhost' }, { host: '8.8.8.8' },
      { path: 'http://example.invalid/health' }, { path: '/health?token=x' }, { path: '/../health' }]) {
      const result = await invoke(input(8080, changes));
      assert.equal(result.code, 2);
      assert.ok(result.data.error.code.startsWith('test_http_'));
      assert.ok(!JSON.stringify(result.data).includes('example.invalid'));
    }
  });
  await test('invalid status, marker, deadline, duplicate ID and extra field fail closed', async () => {
    const duplicate = input(8080);
    duplicate.endpoints.push({ ...duplicate.endpoints[0], port: 8081 });
    for (const value of [input(8080, { expectedStatus: 302 }), input(8080, { bodyIncludes: '' }),
      input(8080, { timeoutMs: 2001 }), input(8080, { command: 'npm test' }), duplicate]) {
      const result = await invoke(value);
      assert.equal(result.code, 2);
      assert.equal(result.data.ok, false);
      assert.equal(result.data.advisoryOnly, true);
    }
  });
  await test('duplicate JSON keys, invalid flags and excessive batch have no network result', async () => {
    const raw = JSON.stringify(input(8080)).replace('"schema":', '"schema":"other","schema":');
    const duplicate = await invoke(raw);
    assert.equal(duplicate.data.error.code, 'duplicate_json_key');
    const flag = await invoke(input(8080), ['test-plan', 'http-probe', '--bad', '--json']);
    assert.equal(flag.data.error.code, 'invalid_cli_arguments');
    const batch = input(8080);
    batch.endpoints = Array.from({ length: 17 }, (_, i) => ({ ...batch.endpoints[0], id: `endpoint-${i}` }));
    const excessive = await invoke(batch);
    assert.equal(excessive.data.error.code, 'test_http_endpoints_invalid');
  });
}
main().finally(() => {
  const resolved = fs.realpathSync(arena);
  assert.equal(path.dirname(resolved).toLowerCase(), fs.realpathSync(os.tmpdir()).toLowerCase());
  assert.ok(path.basename(resolved).startsWith('leerness-test-http-'));
  removeTree(resolved, { recursive: true, force: true });
  console.log(`test HTTP probe: ${passed}/${passed + failed} passed`);
  if (failed) process.exitCode = 1;
});
