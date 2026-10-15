'use strict';
require('./temp-cleanup').trackTemp(module); // T-0357: records this run's temp folders; the runner that started it removes them after a clean exit

const assert = require('node:assert/strict');
const cp = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { INPUT_SCHEMA, probeFirestorePrerequisites } = require('../lib/test-firestore-probe');
const { removeTree } = require('./temp-cleanup');

const cli = path.resolve(__dirname, '../bin/leerness.js');
const arena = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-test-firestore-'));
let passed = 0;
let failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('PASS ' + name); }
  catch (error) { failed++; console.error('FAIL ' + name + ': ' + error.stack); }
}
function input(port, changes = {}) {
  return { schema: INPUT_SCHEMA, endpoints: [{ id: 'firestore', host: '127.0.0.1', port,
    projectId: 'demo-leerness-probe', timeoutMs: 500, ...changes }] };
}
function invoke(value, args = ['test-plan', 'firestore-probe', '--stdin', '--json']) {
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
const validBody = JSON.stringify({ rules: { files: [] }, marker: 'private-response-marker' });
function hubBody(hubPort, firestorePort, changes = {}) {
  return JSON.stringify({ hub: { name: 'hub', host: '127.0.0.1', port: hubPort },
    firestore: { name: 'firestore', host: '127.0.0.1', port: firestorePort },
    marker: 'private-hub-marker', ...changes });
}
async function main() {
  await test('fixed GET path and JSON response shape are observed without a readiness claim', async () => {
    await withServer((request, response) => {
      assert.equal(request.method, 'GET');
      assert.equal(request.url, '/emulator/v1/projects/demo-leerness-probe:ruleCoverage');
      assert.equal(request.headers.accept, 'application/json');
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' }).end(validBody);
    }, async port => {
      const result = await probeFirestorePrerequisites(input(port));
      assert.equal(result.results[0].status, 'firestore-protocol-shape');
      assert.equal(result.allProtocolShapesObserved, true);
      assert.equal(result.projectIdentityVerified, false);
      assert.equal(result.serviceReadyVerified, false);
      assert.equal(result.testPassVerified, false);
      assert.equal(result.finalGatePassed, false);
      assert.equal(result.evidenceReusable, false);
      assert.equal(Object.hasOwn(result.results[0], 'hubStatus'), false);
      assert.equal(Object.hasOwn(result, 'allHubMappingsObserved'), false);
      assert.deepEqual(Object.keys(result).sort(), ['schema', 'observed', 'probeKind', 'results',
        'allProtocolShapesObserved', 'projectIdentityVerified', 'serviceReadyVerified',
        'testPassVerified', 'finalGatePassed', 'evidenceReusable'].sort());
      assert.deepEqual(Object.keys(result.results[0]).sort(), ['id', 'status',
        'protocolShapeObserved', 'httpResponseObserved', 'observedStatus', 'elapsedMs'].sort());
      assert.ok(!JSON.stringify(result).includes('private-response-marker'));
    });
  });
  await test('same response for a different project never verifies project identity', async () => {
    await withServer((request, response) => {
      assert.equal(request.url, '/emulator/v1/projects/demo-other:ruleCoverage');
      response.writeHead(200, { 'content-type': 'application/json' }).end(validBody);
    }, async port => {
      const result = await probeFirestorePrerequisites(input(port, { projectId: 'demo-other' }));
      assert.equal(result.results[0].protocolShapeObserved, true);
      assert.equal(result.projectIdentityVerified, false);
      assert.equal(result.serviceReadyVerified, false);
    });
  });
  await test('non-200 and redirect responses are never followed', async () => {
    let hits = 0;
    await withServer((request, response) => {
      hits++;
      response.writeHead(302, { location: 'http://example.invalid' }).end();
    }, async port => {
      const result = await probeFirestorePrerequisites(input(port));
      assert.equal(result.results[0].status, 'http-status-mismatch');
      assert.equal(result.results[0].observedStatus, 302);
      assert.equal(hits, 1);
    });
  });
  await test('content type, malformed JSON and invalid UTF-8 are rejected', async () => {
    for (const [contentType, body, expected] of [
      ['text/plain', validBody, 'content-type-mismatch'],
      ['application/json', '{', 'protocol-shape-mismatch'],
      ['application/json', Buffer.from([0xff]), 'protocol-shape-mismatch']]) {
      await withServer((request, response) => response.writeHead(200, { 'content-type': contentType }).end(body), async port => {
        const result = await probeFirestorePrerequisites(input(port));
        assert.equal(result.results[0].status, expected);
      });
    }
  });
  await test('lookalike JSON without rules.files array is rejected', async () => {
    for (const body of ['[]', '{}', '{"rules":{"files":{}}}', '{"rules":{"files":null}}']) {
      await withServer((request, response) => response.writeHead(200, { 'content-type': 'application/json' }).end(body), async port => {
        const result = await probeFirestorePrerequisites(input(port));
        assert.equal(result.results[0].status, 'protocol-shape-mismatch');
      });
    }
  });
  await test('large response, deadline and closed port remain distinct', async () => {
    await withServer((request, response) => response.writeHead(200, { 'content-type': 'application/json' })
      .end('x'.repeat(65537)), async port => {
      const result = await probeFirestorePrerequisites(input(port));
      assert.equal(result.results[0].status, 'http-response-too-large');
    });
    await withServer(() => {}, async port => {
      const result = await probeFirestorePrerequisites(input(port, { timeoutMs: 30 }));
      assert.equal(result.results[0].status, 'timeout');
    });
    let closedPort;
    await withServer((request, response) => response.end(), async port => { closedPort = port; });
    const closed = await probeFirestorePrerequisites(input(closedPort));
    assert.equal(closed.results[0].status, 'connection-refused');
  });
  await test('CLI emits bounded metadata without project files or raw body', async () => {
    await withServer((request, response) => response.writeHead(200, { 'content-type': 'application/json' }).end(validBody), async port => {
      const marker = path.join(arena, 'keep.txt'); fs.writeFileSync(marker, 'owner data\n');
      const before = fs.readFileSync(marker);
      const result = await invoke(input(port));
      assert.equal(result.code, 0);
      assert.equal(result.stderr, '');
      assert.equal(result.data.probe.results[0].status, 'firestore-protocol-shape');
      assert.equal(result.data.probe.projectIdentityVerified, false);
      assert.ok(!JSON.stringify(result.data).includes('private-response-marker'));
      assert.deepEqual(fs.readFileSync(marker), before);
      assert.equal(fs.existsSync(path.join(arena, '.leerness')), false);
    });
  });
  await test('external host, invalid project ID, port and extra fields fail closed', async () => {
    for (const changes of [{ host: 'localhost' }, { host: '8.8.8.8' }, { projectId: 'A-project' },
      { projectId: 'demo-project-' }, { projectId: 'short' }, { projectId: 'demo-project?token=x' },
      { port: 0 }, { timeoutMs: 2001 }, { command: 'npm test' }]) {
      const result = await invoke(input(8080, changes));
      assert.equal(result.code, 2);
      assert.ok(result.data.error.code.startsWith('test_firestore_'));
      assert.ok(!JSON.stringify(result.data).includes('token=x'));
    }
  });
  await test('duplicate keys, duplicate IDs, oversized batch and invalid flags are rejected', async () => {
    const duplicateKey = await invoke(JSON.stringify(input(8080)).replace('"schema":', '"schema":"other","schema":'));
    assert.equal(duplicateKey.data.error.code, 'duplicate_json_key');
    const duplicate = input(8080);
    duplicate.endpoints.push({ ...duplicate.endpoints[0], port: 8081 });
    assert.equal((await invoke(duplicate)).data.error.code, 'test_firestore_id_duplicate');
    const batch = input(8080);
    batch.endpoints = Array.from({ length: 17 }, (_, i) => ({ ...batch.endpoints[0], id: `item-${i}` }));
    assert.equal((await invoke(batch)).data.error.code, 'test_firestore_endpoints_invalid');
    assert.equal((await invoke(input(8080), ['test-plan', 'firestore-probe', '--bad', '--json']))
      .data.error.code, 'invalid_cli_arguments');
  });
  await test('Firebase hub mapping corroborates a local Firestore port without verifying identity', async () => {
    await withServer((request, response) => response.writeHead(200, { 'content-type': 'application/json' }).end(validBody), async firestorePort => {
      await withServer((request, response) => {
        assert.equal(request.method, 'GET');
        assert.equal(request.url, '/emulators');
        assert.equal(request.headers.accept, 'application/json');
        response.writeHead(200, { 'content-type': 'application/json' }).end(hubBody(request.socket.localPort, firestorePort));
      }, async hubPort => {
        const result = await invoke(input(firestorePort, { hubPort, projectId: 'demo-other' }));
        assert.equal(result.code, 0);
        assert.equal(result.data.probe.results[0].hubStatus, 'hub-firestore-mapped');
        assert.equal(result.data.probe.results[0].hubMappingObserved, true);
        assert.equal(result.data.probe.allHubMappingsObserved, true);
        assert.equal(result.data.probe.projectIdentityVerified, false);
        assert.equal(result.data.probe.serviceReadyVerified, false);
        assert.equal(result.data.probe.testPassVerified, false);
        assert.ok(!JSON.stringify(result.data).includes('private-hub-marker'));
        const mixedInput = input(firestorePort, { hubPort });
        const legacy = { ...mixedInput.endpoints[0], id: 'without-hub' };
        delete legacy.hubPort;
        mixedInput.endpoints.push(legacy);
        const mixed = await probeFirestorePrerequisites(mixedInput);
        assert.equal(mixed.allHubMappingsObserved, true);
        assert.equal(Object.hasOwn(mixed.results[1], 'hubStatus'), false);
      });
    });
  });
  await test('hub absent, wrong port or wrong host do not corroborate Firestore', async () => {
    await withServer((request, response) => response.writeHead(200, { 'content-type': 'application/json' }).end(validBody), async firestorePort => {
      for (const [change, expected] of [
        [{ firestore: null }, 'hub-firestore-missing'],
        [{ firestore: { name: 'firestore', host: '127.0.0.1', port: firestorePort + 1 } }, 'hub-port-mismatch'],
        [{ firestore: { name: 'firestore', host: '127.0.0.2', port: firestorePort } }, 'hub-host-mismatch'],
        [{ firestore: { name: 'firestore', host: '127.0.0.1', port: firestorePort,
          listen: [{ address: '127.0.0.2', port: firestorePort }] } }, 'hub-host-mismatch'],
        [{ hub: { name: 'hub', host: '127.0.0.1', port: 1 } }, 'hub-self-mismatch']]) {
        await withServer((request, response) => response.writeHead(200, { 'content-type': 'application/json' })
          .end(hubBody(request.socket.localPort, firestorePort, change)), async hubPort => {
          const result = await probeFirestorePrerequisites(input(firestorePort, { hubPort }));
          assert.equal(result.results[0].hubStatus, expected);
          assert.equal(result.results[0].hubMappingObserved, false);
          assert.equal(result.results[0].protocolShapeObserved, true);
          assert.equal(result.serviceReadyVerified, false);
        });
      }
    });
  });
  await test('hub status, content type, malformed JSON and oversized body remain untrusted', async () => {
    await withServer((request, response) => response.writeHead(200, { 'content-type': 'application/json' }).end(validBody), async firestorePort => {
      for (const [status, contentType, body, expected] of [
        [302, 'application/json', '{}', 'hub-http-status-mismatch'],
        [200, 'text/plain', '{}', 'hub-content-type-mismatch'],
        [200, 'application/json', '{', 'hub-json-invalid'],
        [200, 'application/json', Buffer.from([0xff]), 'hub-json-invalid'],
        [200, 'application/json', 'x'.repeat(16385), 'hub-response-too-large']]) {
        await withServer((request, response) => response.writeHead(status, { 'content-type': contentType }).end(body), async hubPort => {
          const result = await probeFirestorePrerequisites(input(firestorePort, { hubPort }));
          assert.equal(result.results[0].hubStatus, expected);
          assert.equal(result.allHubMappingsObserved, false);
        });
      }
    });
  });
  await test('hub timeout, refusal and duplicate JSON keys are not mapped', async () => {
    await withServer((request, response) => response.writeHead(200, { 'content-type': 'application/json' }).end(validBody), async firestorePort => {
      await withServer(() => {}, async hubPort => {
        const result = await probeFirestorePrerequisites(input(firestorePort, { hubPort, timeoutMs: 30 }));
        assert.equal(result.results[0].hubStatus, 'hub-timeout');
      });
      let closedPort;
      await withServer((request, response) => response.end(), async port => { closedPort = port; });
      const closed = await probeFirestorePrerequisites(input(firestorePort, { hubPort: closedPort }));
      assert.equal(closed.results[0].hubStatus, 'hub-connection-refused');
      await withServer((request, response) => response.writeHead(200, { 'content-type': 'application/json' })
        .end('{"hub":{},"hub":{},"firestore":{}}'), async hubPort => {
        const duplicate = await probeFirestorePrerequisites(input(firestorePort, { hubPort }));
        assert.equal(duplicate.results[0].hubStatus, 'hub-json-invalid');
      });
    });
  });
  await test('invalid hub ports and extra fields are rejected before dialing', async () => {
    for (const changes of [{ hubPort: 0 }, { hubPort: 65536 }, { hubPort: '4400' },
      { hubPort: 4400, hubHost: 'example.invalid' }]) {
      const result = await invoke(input(8080, changes));
      assert.equal(result.code, 2);
      assert.ok(result.data.error.code.startsWith('test_firestore_'));
      assert.ok(!JSON.stringify(result.data).includes('example.invalid'));
    }
  });
}
main().finally(() => {
  const resolved = fs.realpathSync(arena);
  assert.equal(path.dirname(resolved).toLowerCase(), fs.realpathSync(os.tmpdir()).toLowerCase());
  assert.ok(path.basename(resolved).startsWith('leerness-test-firestore-'));
  removeTree(resolved, { recursive: true, force: true });
  console.log(`${passed}/${passed + failed} passed`);
  if (failed) process.exitCode = 1;
});
