'use strict';

// Offline transport integration: ephemeral TLS certificate + real loopback
// sockets. The request shim is test-local; the shipped API has no host override.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
const https = require('node:https');
const net = require('node:net');
const crypto = require('node:crypto');
const { retrieveOpenAiResponse: retrieve } = require('../lib/openai-response-retrieval');

const tests = [];
const test = (name, run) => tests.push({ name, run });
const key = `fixture-${crypto.randomUUID()}`;
const query = { responseId: 'resp_fixture', projectId: 'proj_fixture', organizationId: 'org_fixture', timeoutMs: 2000 };
const sample = () => ({ object: 'response', id: query.responseId, status: 'completed', model: 'fixture-model',
  created_at: 1741386163, output: [{ type: 'reasoning', summary: [] },
    { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '한글 ✓' }] },
    { type: 'function_call', name: 'never_execute', arguments: '{}' }],
  instructions: 'not returned', metadata: { ignored: true } });
let handler, trusted = true, wrongName = false, received = 0, attempted = 0, lastRequest;
let server, originalRequest, dir, stallPort;
const contractErrors = [];
const call = (changes = {}, credential = key) => retrieve(JSON.stringify({ ...query, ...changes }), credential);
const send = (res, value = sample(), headers = {}) => {
  res.writeHead(200, { 'content-type': 'application/json', ...headers });
  res.end(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value));
};
const fail = (out, code) => {
  assert.deepEqual(out, { schema: 'leerness.openai-response-retrieval/v1', executionBindingVerified: false,
    retryAllowed: false, approvalGranted: false, ok: false, error: { code } });
  assert.equal(JSON.stringify(out).includes(key), false);
};
async function oneFailure(code, respond, changes) {
  handler = respond;
  const before = attempted;
  fail(await call(changes), code);
  assert.equal(attempted, before + 1, 'one request, no automatic retry');
}

test('fixed GET sends explicit credentials and scope, preserves typed output without approval', async () => {
  handler = (_req, res) => send(res, sample(), { 'openai-organization': query.organizationId });
  const before = received, out = await call();
  assert.equal(received, before + 1);
  assert.equal(out.ok, true);
  assert.equal(out.executionBindingVerified, false); assert.equal(out.retryAllowed, false); assert.equal(out.approvalGranted, false);
  assert.deepEqual(out.requestedScope, { projectId: query.projectId, organizationId: query.organizationId });
  assert.deepEqual(out.response, { id: query.responseId, status: 'completed', model: 'fixture-model', createdAt: 1741386163, output: sample().output });
  assert.equal(lastRequest.method, 'GET'); assert.equal(lastRequest.url, '/v1/responses/resp_fixture');
  assert.equal(lastRequest.headers.authorization, `Bearer ${key}`);
  assert.equal(lastRequest.headers['openai-project'], query.projectId);
  assert.equal(lastRequest.headers['openai-organization'], query.organizationId);
  assert.equal(lastRequest.headers['accept-encoding'], 'identity');
  assert.equal(lastRequest.body, '');
});

test('all six provider states stay observations, including nonterminal and failed outcomes', async () => {
  for (const status of ['queued', 'in_progress', 'completed', 'failed', 'cancelled', 'incomplete']) {
    handler = (_req, res) => send(res, { ...sample(), status, output: [] });
    const out = await call(); assert.equal(out.ok, true); assert.equal(out.response.status, status);
    assert.equal(out.retryAllowed, false); assert.equal(out.approvalGranted, false);
  }
});
test('optional organization omitted, ambient endpoint/key cannot override explicit arguments', async () => {
  const before = process.env.OPENAI_BASE_URL;
  process.env.OPENAI_BASE_URL = 'http://invalid.example/';
  try {
    handler = (_req, res) => send(res);
    const value = { ...query }; delete value.organizationId;
    const out = await retrieve(JSON.stringify(value), key);
    assert.equal(out.ok, true); assert.equal(out.requestedScope.organizationId, null);
    assert.equal(lastRequest.headers['openai-organization'], undefined);
    fail(await retrieve(JSON.stringify(value)), 'retrieval_input_invalid');
  } finally { if (before === undefined) delete process.env.OPENAI_BASE_URL; else process.env.OPENAI_BASE_URL = before; }
});
test('invalid input, injection, prototype keys, endpoint and custom transport rejected before any request', async () => {
  const before = attempted;
  for (const value of [null, [], {}, { ...query, responseId: '../responses' }, { ...query, responseId: 'resp_x?stream=true' },
    { ...query, projectId: 'a\r\nX: b' }, { ...query, organizationId: null }, { ...query, timeoutMs: 99 },
    { ...query, timeoutMs: 15001 }, { ...query, timeoutMs: 100.5 }, { ...query, responseId: 'x'.repeat(257) },
    { ...query, projectId: '' }, { ...query, baseURL: 'https://invalid.example' }, { ...query, request: 'override' }]) {
    fail(await retrieve(JSON.stringify(value), key), 'retrieval_input_invalid');
  }
  for (const value of ['', ' ', 'x\r\ny', 'x'.repeat(4097), {}, null]) fail(await call({}, value), 'retrieval_input_invalid');
  for (const value of [query, '{', JSON.stringify(query).replace('"responseId":', '"responseId":"other","responseId":'),
    JSON.stringify(query).replace('{', '{"__proto__":{},'), ' '.repeat(4097)]) fail(await retrieve(value, key), 'retrieval_input_invalid');
  assert.equal(attempted, before);
});
test('TLS rejects an untrusted server without sending credentials', async () => {
  const before = received; trusted = false;
  try { await oneFailure('retrieval_unavailable', (_req, res) => send(res)); }
  finally { trusted = true; }
  assert.equal(received, before);
});
test('TLS rejects a certificate name mismatch', async () => {
  const before = received; wrongName = true;
  try { await oneFailure('retrieval_unavailable', (_req, res) => send(res)); }
  finally { wrongName = false; }
  assert.equal(received, before);
});
test('redirects never forward credentials or follow Location', async () => {
  for (const status of [301, 302, 303, 307, 308]) await oneFailure('redirect_rejected', (_req, res) => {
    res.writeHead(status, { Location: 'https://invalid.example/capture' }); res.end(key);
  });
});
test('denied, missing, gone, rate limited and server errors are unresolved with no retry', async () => {
  for (const [status, code] of [[401, 'retrieval_denied'], [403, 'retrieval_denied'], [404, 'response_unavailable'],
    [410, 'response_unavailable'], [429, 'retrieval_rate_limited'], [500, 'retrieval_http_error'], [204, 'retrieval_http_error']]) {
    await oneFailure(code, (_req, res) => { res.writeHead(status, { 'Retry-After': '0' }); res.end(key); });
  }
});
test('mismatched organization response rejected', async () => {
  await oneFailure('response_scope_mismatch', (_req, res) => send(res, sample(), { 'openai-organization': 'org_other' }));
});
test('unknown status, wrong ID, wrong object and invalid projection rejected', async () => {
  for (const change of [{ id: 'resp_other' }, { status: 'future_status' }, { object: 'list' }, { model: '' },
    { created_at: 1.5 }, { output: {} }, { output: [null] }, { output: [{ type: '' }] }]) {
    await oneFailure('response_invalid', (_req, res) => send(res, { ...sample(), ...change }));
  }
});
test('duplicate escaped JSON keys and excessive structure rejected', async () => {
  for (const body of ['{"id":"other","\\u0069d":"resp_fixture"}', '{', 'null',
    JSON.stringify({ ...sample(), output: Array.from({ length: 1001 }, () => ({ type: 'message' })) }),
    JSON.stringify({ ...sample(), nested: JSON.parse('['.repeat(18) + '0' + ']'.repeat(18)) })]) {
    await oneFailure('response_invalid', (_req, res) => send(res, body));
  }
});
test('fatal UTF-8 and BOM rejection, split multibyte text accepted', async () => {
  for (const body of [Buffer.from([0xc3, 0x28]), Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(JSON.stringify(sample()))])]) {
    await oneFailure('response_invalid', (_req, res) => send(res, body));
  }
  handler = (_req, res) => {
    const body = Buffer.from(JSON.stringify(sample())), split = body.indexOf(Buffer.from('한')) + 1;
    res.writeHead(200, { 'content-type': 'Application/JSON; charset=UTF-8' }); res.write(body.subarray(0, split));
    setImmediate(() => res.end(body.subarray(split)));
  };
  assert.equal((await call()).ok, true);
});
test('stream and compressed response formats rejected', async () => {
  for (const headers of [{ 'content-type': 'text/event-stream' }, { 'content-type': 'text/html' },
    { 'content-type': 'application/json; charset=latin1' }, { 'content-encoding': 'gzip' }]) {
    await oneFailure('response_format_invalid', (_req, res) => send(res, sample(), headers));
  }
});
test('declared oversized response rejected before consuming its body', async () => {
  await oneFailure('response_too_large', (_req, res) => { res.writeHead(200, { 'content-type': 'application/json', 'content-length': '65537' }); res.flushHeaders(); });
});
test('chunked overflow rejected and exact byte limit accepted', async () => {
  await oneFailure('response_too_large', (_req, res) => send(res, ' '.repeat(65537)));
  const base = JSON.stringify(sample()), padded = base + ' '.repeat(65536 - Buffer.byteLength(base));
  handler = (_req, res) => send(res, padded);
  assert.equal((await call()).ok, true);
});
test('socket failure before headers returns a sanitized failure', async () => {
  await oneFailure('retrieval_unavailable', (req) => req.socket.destroy());
});
test('truncated HTTP body never becomes a successful observation', async () => {
  await oneFailure('retrieval_incomplete', (_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json', 'content-length': '2000' }); res.write('{');
    setTimeout(() => res.destroy(), 20);
  });
});
test('absolute deadline covers a server that never sends headers', async () => {
  const start = Date.now(); await oneFailure('retrieval_timeout', () => {}, { timeoutMs: 150 });
  assert.ok(Date.now() - start < 1500);
});
test('absolute deadline includes a TLS handshake that never completes', async () => {
  const sockets = new Set(), stalled = net.createServer(socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  await new Promise(resolve => stalled.listen(0, '127.0.0.1', resolve));
  const before = received; stallPort = stalled.address().port;
  try { await oneFailure('retrieval_timeout', () => {}, { timeoutMs: 150 }); }
  finally { stallPort = undefined; for (const socket of sockets) socket.destroy(); await new Promise(resolve => stalled.close(resolve)); }
  assert.equal(received, before);
});
test('oversized HTTP headers fail without echoing provider data', async () => {
  await oneFailure('retrieval_unavailable', (_req, res) => send(res, sample(), { 'x-fixture': 'x'.repeat(17000) }));
});
test('absolute deadline is not extended by trickling body bytes', async () => {
  const start = Date.now(); await oneFailure('retrieval_timeout', (_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' }); res.write(' ');
    const timer = setInterval(() => res.write(' '), 25); res.on('close', () => clearInterval(timer));
  }, { timeoutMs: 150 });
  assert.ok(Date.now() - start < 1500);
});
test('concurrent retrievals keep independent scope and deadlines', async () => {
  handler = (req, res) => {
    if (req.url.endsWith('resp_slow')) return;
    send(res, { ...sample(), id: 'resp_fast' });
  };
  const [slow, fast] = await Promise.all([call({ responseId: 'resp_slow', timeoutMs: 150 }),
    call({ responseId: 'resp_fast', projectId: 'proj_other' })]);
  fail(slow, 'retrieval_timeout'); assert.equal(fast.ok, true); assert.equal(fast.requestedScope.projectId, 'proj_other');
});

async function main() {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lr-get-'));
  const openssl = process.platform === 'win32' && fs.existsSync('C:\\Program Files\\Git\\usr\\bin\\openssl.exe')
    ? 'C:\\Program Files\\Git\\usr\\bin\\openssl.exe' : 'openssl';
  const keyPath = path.join(dir, 'key.pem'), certPath = path.join(dir, 'cert.pem');
  const config = path.join(dir, 'openssl.cnf'); fs.writeFileSync(config, '[req]\ndistinguished_name=dn\n[dn]\n');
  const generated = cp.spawnSync(openssl, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-config', config,
    '-keyout', keyPath, '-out', certPath, '-days', '1', '-subj', '/CN=api.openai.com', '-addext', 'subjectAltName=DNS:api.openai.com'],
  { windowsHide: true, timeout: 20000, encoding: 'utf8' });
  assert.equal(generated.status, 0, 'ephemeral TLS certificate generation must succeed; no skip');
  const certificate = fs.readFileSync(certPath);
  server = https.createServer({ key: fs.readFileSync(keyPath), cert: certificate }, (req, res) => {
    received++;
    lastRequest = { method: req.method, url: req.url, headers: req.headers, body: '' };
    const captured = lastRequest, respond = handler;
    req.on('data', chunk => { captured.body += chunk; });
    req.on('end', () => respond(req, res));
  });
  server.on('tlsClientError', () => {});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  originalRequest = https.request;
  https.request = (options, callback) => {
    attempted++;
    try {
      assert.equal(options.hostname, 'api.openai.com'); assert.equal(options.protocol, 'https:'); assert.equal(options.port, 443);
      assert.equal(options.servername, 'api.openai.com'); assert.equal(options.rejectUnauthorized, true); assert.equal(options.agent, false);
      assert.equal(options.method, 'GET'); assert.match(options.path, /^\/v1\/responses\/[A-Za-z0-9_-]+$/);
    } catch (error) { contractErrors.push(error); throw error; }
    return originalRequest({ ...options, hostname: '127.0.0.1', port: stallPort || server.address().port,
      ...(trusted ? { ca: certificate } : {}), ...(wrongName ? { servername: 'wrong.invalid' } : {}) }, callback);
  };
  let passed = 0;
  for (const { name, run } of tests) {
    try { await run(); passed++; console.log(`PASS ${name}`); }
    catch (error) { console.error(`FAIL ${name}: ${error.message}`); }
  }
  assert.equal(contractErrors.length, 0, 'adapter must not swallow test interception assertions');
  console.log(`${passed}/${tests.length} PASS; real loopback TLS only; no provider calls`);
  if (passed !== tests.length) process.exitCode = 1;
}
main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(async () => {
  if (originalRequest) https.request = originalRequest;
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  if (dir) {
    const resolved = fs.realpathSync(dir), temp = fs.realpathSync(os.tmpdir());
    assert.equal(path.dirname(resolved), temp); assert.ok(path.basename(resolved).startsWith('lr-get-'));
    fs.rmSync(resolved, { recursive: true });
  }
});
